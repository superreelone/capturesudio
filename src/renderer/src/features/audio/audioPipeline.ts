/**
 * Web Audio mixer:
 *   mic stream ─→ micGain ─→ micAnalyser ─┐
 *                                          ├─→ masterGain ─→ destination ─→ MediaStream
 *   sys stream ─→ sysGain ─→ sysAnalyser ─┘
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
    this.micAnalyser = this.ctx.createAnalyser();
    this.micAnalyser.fftSize = 1024;
    this.micGain.connect(this.micAnalyser).connect(this.masterGain);

    this.sysGain = this.ctx.createGain();
    this.sysAnalyser = this.ctx.createAnalyser();
    this.sysAnalyser.fftSize = 1024;
    this.sysGain.connect(this.sysAnalyser).connect(this.masterGain);
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
