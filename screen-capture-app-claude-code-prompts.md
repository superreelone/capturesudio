# Screen Recorder + Screenshot App — Claude Code Build Playbook

A staged set of copy-paste prompts to build a cross-platform (Windows + macOS) screen recording and screenshot app for content creators, with license-key activation, subscription handling, and user authentication.

Paste the prompts into Claude Code **one phase at a time**, in order. Each phase builds on the last. Don't paste everything at once — Claude Code works best with focused, verifiable steps.

---

## Recommended tech stack

| Layer | Choice | Why |
|---|---|---|
| Shell | **Electron** | One codebase for Windows + macOS, rich UI |
| UI | **React + TypeScript + Vite** | Fast, typed, modern |
| Capture | `desktopCapturer` + `getUserMedia` + **MediaRecorder** | Built-in screen/webcam/mic capture |
| Transcoding | **ffmpeg** (`ffmpeg-static`) | Export to MP4/MKV/MOV/WebM/GIF, choose codecs |
| Screenshots | Electron `desktopCapturer` + `sharp` | PNG/JPG/WebP/BMP/TIFF |
| Storage/secrets | `electron-store` + OS keychain (`keytar`) | Settings + secure key storage |
| Licensing | **License-key activation** (offline signed keys, or a service like Keygen / Cryptolens) | Key activation + subscription duration, **no login** |
| Packaging | `electron-builder` | Signed installers + auto-update |

### Be aware of the genuinely hard parts (so nothing surprises you)
1. **System / desktop audio capture** is the hardest piece. Windows needs WASAPI loopback; macOS has no built-in loopback and typically needs a virtual device (e.g. BlackHole) or ScreenCaptureKit. The prompts handle this explicitly in Phase 4.
2. **Licensing — no login required.** With offline signed keys you need **no server at all** (simplest path to a shippable product). An online service enforces subscription expiry and device limits more strictly. The prompts cover both; offline keys are the lean default.
3. **Code signing costs money and is separate.** Windows needs an Authenticode cert; macOS needs an Apple Developer ID + notarization. Without signing, users see security warnings. Phase 9 covers it.
4. **macOS permissions** (Screen Recording, Microphone, Camera) must be requested correctly or capture silently fails.

> Alternative if you want maximum performance/quality later: native capture via Windows Graphics Capture API / macOS ScreenCaptureKit (e.g. a Tauri + Rust build). Electron is the pragmatic, buildable path and is what these prompts assume.

---

## Prerequisites (do this once, before Phase 1)
- Install **Node.js LTS**, **Git**, and **Claude Code**.
- Have **ffmpeg** available (the `ffmpeg-static` package bundles it; no manual install needed).
- Create an empty project folder and open Claude Code inside it.

---

## Phase 0 — Kickoff / context-setting prompt

Paste this first so Claude Code understands the whole project before writing code.

```
I'm building a cross-platform desktop screen recorder + screenshot app for content
creators, called "CaptureStudio" (placeholder name — feel free to suggest a better one).

Stack: Electron + React + TypeScript + Vite, ffmpeg via ffmpeg-static for transcoding,
electron-store for settings, keytar for secure secret storage, electron-builder for packaging.

Target platforms: Windows 10/11 and macOS 12+.

Goals for the full app (we'll build in phases):
- Record full screen / a chosen window / a drawn region, multi-monitor aware
- Microphone + system audio capture, mixable, with level meters
- Webcam picture-in-picture overlay
- Adjustable FPS (30/60), resolution, bitrate/quality presets
- Pause/resume, countdown timer, global hotkeys
- Export to MP4 (H.264/H.265), MKV, MOV, WebM (VP9), and animated GIF
- Screenshots: full / window / region, delayed capture, annotation, copy to clipboard
- Screenshot formats: PNG, JPG, WebP, BMP, TIFF, with filename templates and auto-save folder
- License-key activation tied to a subscription duration and bound to the device,
  with an offline grace period — NO user login or accounts
- Settings screen, output folder management, auto-update

Constraints and quality bar:
- TypeScript strict mode, ESLint + Prettier
- Clear separation: main process (privileged), preload (contextBridge), renderer (UI)
- Never expose Node APIs directly to the renderer; use a typed IPC bridge
- Store the license key / activation token in the OS keychain via keytar, never in plain files
- Handle macOS permission prompts (Screen Recording, Microphone, Camera) explicitly

Don't write code yet. First, propose the full folder structure, the IPC channel list,
and a phase-by-phase build plan. Then wait for me to approve before scaffolding.
```

---

## Phase 1 — Project scaffold

```
Scaffold the project now based on the plan you proposed.

- Initialize Electron + Vite + React + TypeScript (strict).
- Set up the three-layer structure: src/main, src/preload, src/renderer.
- Configure a typed, secure IPC bridge via contextBridge (no nodeIntegration in renderer,
  contextIsolation on, sandbox where possible).
- Add ESLint + Prettier, npm scripts for dev/build, and a minimal window that opens.
- Add electron-store and create a typed settings module (theme, output folders,
  default formats, hotkeys) with sensible defaults.

Verify it runs with `npm run dev` and show me the resulting tree and the IPC channel types.
```

---

## Phase 2 — Screen capture core

```
Implement core screen recording.

- Use desktopCapturer in the main process to enumerate screens and windows; return
  thumbnails + ids to the renderer over IPC.
- In the renderer, build a source picker UI: Full Screen (per monitor), Window, and
  a "select region" mode (overlay window where the user drags a rectangle).
- Capture the stream via getUserMedia with chromeMediaSource constraints and record it
  with MediaRecorder (start with webm/VP8 or VP9 as the working capture format — we'll
  transcode to other formats in Phase 5).
- Add Start, Pause, Resume, Stop controls and a recording timer + status indicator.
- Write the raw recording to a temp file in the app's data dir, then move/rename it to
  the user's output folder using their filename template.
- Multi-monitor: let the user pick which display to record.

Test on the primary monitor and confirm a playable file is produced.
```

---

## Phase 3 — Region capture + quality controls + hotkeys

```
Add capture refinements.

- Polished region-select overlay: transparent full-screen window, dimmed outside the
  selection, live dimensions readout, Esc to cancel, Enter to confirm.
- Quality presets: 720p/1080p/1440p, FPS 30/60, and bitrate options. Map these to
  MediaRecorder/getUserMedia constraints.
- A pre-recording countdown (3-2-1) overlay, toggleable.
- Global hotkeys via Electron globalShortcut: start/stop, pause/resume, screenshot.
  Make them configurable in settings and persist them.
- Cursor capture toggle, and an optional click-highlight visual effect.

Confirm hotkeys work even when the app window is not focused.
```

---

## Phase 4 — Audio (mic + system audio) [the hard one]

```
Implement audio capture and mixing. This is platform-specific, so handle each OS.

Microphone:
- Enumerate input devices, let the user choose one, capture via getUserMedia, show a
  live level meter, and mix it into the recording.

System/desktop audio:
- Windows: capture loopback. Prefer Electron's desktopCapturer audio loopback support if
  available in our Electron version; otherwise document a fallback (e.g. WASAPI loopback
  via an ffmpeg dshow/wasapi pipeline) and implement the cleanest working option.
- macOS: there is no native loopback. Detect whether a virtual audio device (e.g. BlackHole)
  is installed; if present, allow selecting it as a system-audio source. If not, show a
  clear in-app explainer with setup steps and gracefully fall back to mic-only.

General:
- Allow recording mic-only, system-only, both-mixed, or no audio.
- Independent volume/gain per source and a master mute.
- Ensure audio and video stay in sync in the final file.

Test all four audio modes and verify sync.
```

---

## Phase 5 — Export pipeline with ffmpeg (multiple formats + codecs)

```
Add the export/transcoding pipeline using ffmpeg-static (bundle ffmpeg with the app).

- After a recording stops, offer export options:
  - Container: MP4, MKV, MOV, WebM, and animated GIF
  - Video codec: H.264, H.265/HEVC, VP9 (match valid codec/container combos; disable invalid ones)
  - Quality: CRF/bitrate presets (e.g. High/Balanced/Small file)
  - Resolution downscale option and FPS for GIF
- Run ffmpeg in the main process as a child process; stream progress (parse ffmpeg stderr)
  to a progress bar in the UI; allow cancel.
- Optional fast path: if the user chose a format matching the capture, skip re-encode.
- Save to the user's output folder with the filename template; show a "reveal in folder" action.
- Add a simple built-in trim tool (set in/out points, export the trimmed range via ffmpeg).

Verify each format produces a correct, playable file and the progress bar is accurate.
```

---

## Phase 6 — Screenshots + annotation

```
Implement the screenshot subsystem.

Capture:
- Full screen (per monitor), active/chosen window, and drawn region (reuse the Phase 3 overlay).
- Delayed capture (configurable seconds).
- A global hotkey for instant region screenshot.

Output:
- Save as PNG, JPG, WebP, BMP, or TIFF using sharp; quality slider for lossy formats.
- Copy-to-clipboard option, auto-save to a configurable folder, and filename templates
  (e.g. {app}_{date}_{time}_{counter}).

Annotation editor (opens after capture, optional):
- Tools: arrow, rectangle, ellipse, freehand pen, text, highlighter, and blur/pixelate region.
- Undo/redo, color + thickness pickers, then save or copy the annotated result.

Test each format and each annotation tool.
```

---

## Phase 7 — Webcam overlay + UI polish

```
Add webcam picture-in-picture and finish the main UI.

- Enumerate cameras, preview the feed, and composite a draggable/resizable webcam overlay
  onto the recording (corner presets + free position; circular or rectangular frame).
- Render the composite (screen + webcam + cursor effects) reliably into the recorded stream.
- Build the main dashboard: recent recordings/screenshots gallery with thumbnails,
  quick actions (play, reveal, delete, re-export), and a clean settings screen
  (output folders, default formats, hotkeys, countdown, theme light/dark).

Confirm the webcam overlay appears correctly in the exported file.
```

---

## Phase 8 — License-key activation (no login, no accounts)

```
Implement license-key activation only — NO user accounts, NO login screen. The customer
buys a key, enters it once on their laptop, and the app activates for the subscribed
duration. Pick the model I specify:

[CHOOSE ONE — tell Claude Code which:]

Option A — Offline signed keys (SIMPLEST, fully serverless, no backend to run):
- As the vendor, I generate keys offline by signing a payload (use Ed25519) containing:
  a key id, subscription expiry date, tier/features, and optional max activations.
- Embed the matching PUBLIC key in the app. The app verifies the key's signature offline —
  no internet required to activate.
- On activation, bind the key to this laptop via a stable hardware fingerprint; store the
  activation (key + fingerprint + decoded expiry + tier) in the OS keychain via keytar.
- Also generate the vendor-side key-generator CLI for me (I keep the private key offline).
- Add basic clock-rollback detection (persist last-seen timestamp; flag if the clock
  moves backwards) since offline keys rely on the system clock and can't be revoked remotely.

Option B — Online activation service (stricter subscription/device enforcement):
- Use a licensing service (Keygen or Cryptolens). On activation, send key + hardware
  fingerprint; the service enforces device limits and returns the expiry. Re-validate
  periodically with an offline grace period.
- OR generate a tiny self-hosted Node + SQLite license server with just two endpoints:
  activate(key, fingerprint) and validate(key, fingerprint) -> { valid, expiry, tier }.
  Still NO user accounts — the key is the only credential.

Client behavior (both options):
- First run: a single activation screen — paste key, click Activate. No email, no password.
- A license status panel: active/expired, tier, days remaining, and the bound device.
- Store everything securely in the OS keychain via keytar; never plaintext.
- Offline grace period (e.g. 7 days) for Option B before locking premium features.
- On expiry: gate recording/export behind a clear renewal screen, but keep all
  already-saved recordings and screenshots fully accessible.
- Provide a "Deactivate this device" action so a customer can move their key to a new laptop.
- Handle errors clearly: invalid/malformed key, expired, device limit reached, no network.

Show me the activation flow, exactly what's stored on the device, and the vendor-side
key-generation steps.
```

---

## Phase 9 — Packaging, code signing, auto-update

```
Set up distribution.

- Configure electron-builder to produce a Windows installer (NSIS) and a macOS .dmg.
- Bundle ffmpeg-static correctly so it's found in the packaged app on both OSes.
- macOS: set the required entitlements and Info.plist usage strings for Screen Recording,
  Microphone, and Camera; document the Developer ID signing + notarization steps and where
  I plug in my Apple credentials.
- Windows: document Authenticode signing and where I plug in my code-signing cert.
- Add auto-update via electron-updater pointing at a release feed (GitHub Releases or an
  S3/HTTPS bucket); make update checks non-blocking with a clear "update available" prompt.
- Produce a build checklist and the exact commands to cut a signed release.

Important: do not embed my certificates or credentials in the repo — read them from
environment variables / CI secrets and tell me which ones to set.
```

---

## Phase 10 — Hardening, tests, and final pass

```
Final hardening pass.

- Add unit tests for the settings store, the license-key validation logic (signature
  verify + expiry + device binding), and the ffmpeg command builder; add a couple of
  smoke tests for IPC.
- Audit the IPC surface: confirm contextIsolation is on, the renderer has no direct Node
  access, and every channel validates its payload.
- Add structured logging (no secrets) and a crash/error reporter toggle.
- Write a README: setup, dev, build, signing, and a feature list.
- Give me a prioritized list of anything still rough or not production-ready, especially
  around system-audio capture and licensing edge cases.
```

---

## Suggested order & tips
- Build and **test after every phase** before moving on. Don't let unverified code stack up.
- If a phase is too big for one Claude Code turn, ask it to "do step 1 only, then stop."
- Phase 4 (system audio) is where most real projects stall — budget extra time there.
  Phase 8 (licensing) is now much simpler since there's no login; if you pick offline
  signed keys you skip the backend entirely.
- Keep your signing certs and any API keys in environment variables, never in the repo.

---

## Realistic scope note
"All possible features" is a large app — expect this to be a multi-week build even with Claude Code doing the heavy lifting. Ship a tight MVP first (Phases 1–6: record + screenshot + export), then layer on webcam, auth, and licensing. That gets you something usable fast and de-risks the hard parts.
