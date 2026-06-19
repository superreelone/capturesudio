/**
 * Web Audio mixer:
 *   mic stream ─→ micGain ─→ [boost: compressor → makeupGain] ─→ micAnalyser ─┐
 *                                                                              ├→ masterGain → destination → MediaStream
 *   sys stream ─→ sysGain ──────────────────────────────────→ sysAnalyser ────┘
 *
 * The optional voice-boost stage (DynamicsCompressorNode + makeup GainNode)
 * brings the mic up to broadcast-style loudness so recordings don't sound
 * 10 dB quieter than what Zoom/Voice-Recorder produce for the same hardware.
 * When voice boost is disabled the chain reverts to raw micGain → analyser.
 *
 * Lifetime: own AudioContext; getMixedStream() returns the destination's MediaStream;
 * tracks survive across mode changes (we just rewire gain/source nodes).
 */
export class AudioPipeline {
  readonly ctx: AudioContext;
  readonly destination: MediaStreamAudioDestinationNode;
  readonly masterGain: GainNode;
  readonly micGain: GainNode;
  readonly sysGain: GainNode;
  readonly micAnalyser: AnalyserNode;
  readonly sysAnalyser: AnalyserNode;
  readonly micCompressor: DynamicsCompressorNode;
  readonly micMakeupGain: GainNode;

  private voiceBoost = true;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private sysSource: MediaStreamAudioSourceNode | null = null;
  private currentMicStream: MediaStream | null = null;
  private currentSysStream: MediaStream | null = null;

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.destination = this.ctx.createMediaStreamDestination();

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 1;
    this.masterGain.connect(this.destination);

    this.micGain = this.ctx.createGain();

    // Voice-tuned compressor: pulls up quiet syllables and tames peaks. The
    // values are a tested broadcast-voice preset — threshold high enough that
    // background noise stays below the knee, ratio aggressive enough to keep
    // dynamic range under control, attack/release fast enough to track speech
    // without obvious pumping.
    this.micCompressor = this.ctx.createDynamicsCompressor();
    this.micCompressor.threshold.value = -22; // dB
    this.micCompressor.knee.value = 24;
    this.micCompressor.ratio.value = 6;
    this.micCompressor.attack.value = 0.003;
    this.micCompressor.release.value = 0.18;

    // Makeup gain after compression. +9.5 dB ≈ 3x — pushes the compressed
    // signal back up to perceived loudness comparable to other apps.
    this.micMakeupGain = this.ctx.createGain();
    this.micMakeupGain.gain.value = 3;

    this.micAnalyser = this.ctx.createAnalyser();
    this.micAnalyser.fftSize = 1024;

    this.wireMicChain();

    this.sysGain = this.ctx.createGain();
    this.sysAnalyser = this.ctx.createAnalyser();
    this.sysAnalyser.fftSize = 1024;
    this.sysGain.connect(this.sysAnalyser).connect(this.masterGain);
  }

  /** (Re)connect the mic processing chain based on the current boost mode.
   *  Disconnects then reconnects so a live mid-stream toggle works. */
  private wireMicChain(): void {
    try {
      this.micGain.disconnect();
      this.micCompressor.disconnect();
      this.micMakeupGain.disconnect();
      this.micAnalyser.disconnect();
    } catch {
      // first call — nothing to disconnect yet
    }
    if (this.voiceBoost) {
      this.micGain
        .connect(this.micCompressor)
        .connect(this.micMakeupGain)
        .connect(this.micAnalyser)
        .connect(this.masterGain);
    } else {
      this.micGain.connect(this.micAnalyser).connect(this.masterGain);
    }
  }

  setVoiceBoost(enabled: boolean): void {
    if (enabled === this.voiceBoost) return;
    this.voiceBoost = enabled;
    this.wireMicChain();
  }

  setMicStream(stream: MediaStream | null): void {
    if (stream === this.currentMicStream) return;
    if (this.micSource) {
      try {
        this.micSource.disconnect();
      } catch {
        // ignore
      }
      this.micSource = null;
    }
    this.currentMicStream = stream;
    if (stream && stream.getAudioTracks().length > 0) {
      this.micSource = this.ctx.createMediaStreamSource(stream);
      this.micSource.connect(this.micGain);
      // Defensive: if Chromium had suspended the context (e.g. our window
      // wasn't focused at the moment of construction), the analyser would
      // see no samples and the meter would freeze at silence. Re-resume
      // anytime we connect a new source.
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume().catch(() => undefined);
      }
    }
  }

  setSystemStream(stream: MediaStream | null): void {
    if (stream === this.currentSysStream) return;
    if (this.sysSource) {
      try {
        this.sysSource.disconnect();
      } catch {
        // ignore
      }
      this.sysSource = null;
    }
    this.currentSysStream = stream;
    if (stream && stream.getAudioTracks().length > 0) {
      this.sysSource = this.ctx.createMediaStreamSource(stream);
      this.sysSource.connect(this.sysGain);
    }
  }

  setMicGain(value: number): void {
    this.micGain.gain.value = Math.max(0, Math.min(2, value));
  }

  setSystemGain(value: number): void {
    this.sysGain.gain.value = Math.max(0, Math.min(2, value));
  }

  setMuted(muted: boolean): void {
    this.masterGain.gain.value = muted ? 0 : 1;
  }

  hasAnyAudio(): boolean {
    return this.micSource !== null || this.sysSource !== null;
  }

  getMixedStream(): MediaStream {
    return this.destination.stream;
  }

  async resume(): Promise<void> {
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  async destroy(): Promise<void> {
    this.setMicStream(null);
    this.setSystemStream(null);
    try {
      this.micGain.disconnect();
      this.sysGain.disconnect();
      this.micAnalyser.disconnect();
      this.sysAnalyser.disconnect();
      this.masterGain.disconnect();
    } catch {
      // ignore
    }
    try {
      await this.ctx.close();
    } catch {
      // ignore
    }
  }
}

/**
 * Compute an RMS [0..1] from an AnalyserNode's time-domain data.
 */
export function analyserToLevel(analyser: AnalyserNode, buffer: Uint8Array): number {
  analyser.getByteTimeDomainData(buffer);
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    const v = ((buffer[i] ?? 128) - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / buffer.length);
}
