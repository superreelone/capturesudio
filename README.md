# Ingestra-CaptureStudio

Cross-platform screen recorder + screenshot + documentation tool for content creators,
QA engineers, and support teams. Records screen / window / region with mic + system
audio + webcam picture-in-picture, captures and annotates screenshots in any of 5
formats, exports recordings through ffmpeg to MP4 / MKV / MOV / WebM / GIF, and
assembles selected screenshots into a styled PDF or Word document. Includes a real-time
drawing overlay you can drive with a keyboard, hotkey, **or paired Bluetooth pen**.

Built on Electron + React + TypeScript + Vite, signed for both Windows and macOS,
with offline Ed25519-signed license activation and built-in auto-update via GitHub
Releases.

---

## Features at a glance

### Capture
- **Recording**: full screen / single window / draggable region across multiple displays.
- **Multi-display region overlay** that handles mixed DPI correctly (one transparent window per display).
- **Resolution / fps / bitrate** presets (720p–native, 30/60 fps, 4 bitrate tiers).
- **Audio**: mic + system audio with a Web Audio mixer, per-source gain, master mute, live VU meters; mac BlackHole detection.
- **Webcam PiP**: 5 position presets + custom XY, 3 sizes, rectangular / circular, mirror toggle.
- **Drawing overlay during recording** with 6 tools (pen, highlight, arrow, rect, ellipse, eraser), color + thickness pickers, single-letter tool shortcuts, undo/redo/clear, toggle draw / pass mode via hotkey or Bluetooth pen button.
- **Countdown** (off / 3s / 5s / 10s) on the recording display.
- **Global hotkeys** for start/stop, pause/resume, region/fullscreen/focused-window screenshot, drawing toggle, tab cycle — all rebindable in Settings.

### Screenshot
- Full screen / window / region (release-to-capture, no Enter required).
- Output: **PNG, JPG, WebP, BMP, TIFF**.
- Auto-save immediately, then optionally open the annotator for a separate edited version.
- **Annotator** with: Pen, Line, Arrow, Rectangle, Ellipse, Highlight, Text, Step counter, Stamps (✓ ✕ ★ ! ? ♥), Callout (speech bubble with tail + auto-wrap text), Blur / Pixelate, Crop, fill toggle for shapes, custom color picker, undo / redo, Ctrl+Z / Ctrl+Shift+C / Esc.
- Copy to clipboard, reveal in folder, open in OS default viewer.

### Export
- **Recordings** → MP4 (H.264 / H.265), MKV (H.264 / H.265 / VP9), MOV, WebM (VP9), animated GIF (palette pipeline).
- Three quality tiers per codec (CRF-based for h264/h265/vp9; fps × width for GIF).
- Resolution downscale + trim with in/out points.
- "⚡ Fast path" for `.webm → .webm` (just remuxes, no re-encode).
- Live progress bar from ffmpeg `-progress pipe:1`, cancel mid-encode.

### Library
- Grid of every recording + screenshot with auto-generated thumbnails.
- Per-file Open / Reveal / Re-export / Delete (→ Recycle Bin).
- **Multi-select** for bulk operations.
- **Doc export**: turn selected screenshots into a polished **PDF** or **Word .docx** documentation deliverable:
  - A4 / Letter / Legal × portrait / landscape.
  - 1 / 2 / 4 / 6 per page grid layouts.
  - Editable per-image captions, drag-to-reorder.
  - **Section headings** — chapter dividers between groups (real `HEADING_1` in Word for the navigation pane).
  - Author field, intro notes, optional logo on cover page, optional page numbers.

### Licensing
- Offline **Ed25519** signed keys — no backend, no network call.
- Hardware-fingerprint binding with **safeStorage** encryption (no `keytar` native dep).
- Clock-rollback detection.
- Vendor `npm run keygen:issue` CLI for one-line key generation.
- Activation screen, license panel with deactivate-this-device action.

### Distribution + updates
- `electron-builder` configured for Windows NSIS, macOS DMG (x64 + arm64), Linux AppImage.
- Authenticode + Apple Developer ID hooks via env vars (never in repo).
- macOS hardened-runtime entitlements + Info.plist usage strings for screen / mic / camera.
- **Auto-update** via electron-updater pointing at GitHub Releases; non-blocking banner with download progress + "Restart & install".

### Brand + Theming
- Light / Dark / System theme with live OS preference sync.
- App branded with **Ingestra logo** (auto-optimized at build time from a single master PNG).

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Renderer (sandboxed React app, contextIsolation: true)       │
│  ├─ features/capture     ─┐                                   │
│  ├─ features/screenshots  │   window.api.* via contextBridge  │
│  ├─ features/library      │── all calls funnel through a      │
│  ├─ features/export       │   typed IPC contract (zod-checked │
│  ├─ features/license      │   on the way in to main).         │
│  ├─ features/bluetooth    │                                   │
│  ├─ features/updater     ─┘                                   │
│  └─ drawing-overlay/  ── separate transparent window          │
└──────────────────────────────────────────────────────────────┘
              ▲                                  ▲
              │ ipcRenderer.invoke               │ event push
              ▼                                  │
┌──────────────────────────────────────────────────────────────┐
│  Main (Node + Electron, full privilege)                       │
│  ├─ ipc/registry.ts → ~25 invoke handlers                     │
│  ├─ services/                                                 │
│  │   ├─ settings.store.ts (electron-store + zod migration)    │
│  │   ├─ recording-session.service.ts (temp file streaming)    │
│  │   ├─ ffmpeg.service.ts + ffmpeg-args.ts (child process)    │
│  │   ├─ screenshot.service.ts (desktopCapturer + sharp)       │
│  │   ├─ files.service.ts (list + delete + save-as)            │
│  │   ├─ drawing.service.ts (overlay window manager)           │
│  │   ├─ license.service.ts → license-verify.ts (pure)         │
│  │   ├─ fingerprint.service.ts (platform machine id)          │
│  │   ├─ updater.service.ts (electron-updater)                 │
│  │   ├─ bluetooth.service.ts (select-bluetooth-device)        │
│  │   └─ crash.service.ts (uncaughtException + crashReporter)  │
│  └─ windows/                                                  │
│      ├─ region-overlay.window.ts (one per display)            │
│      ├─ countdown.window.ts                                   │
│      └─ drawing-overlay handled inline                        │
└──────────────────────────────────────────────────────────────┘
```

Shared code lives in `src/shared/`: IPC channel names, request/response shapes, zod
schemas, the filename-template engine, and the export option matrix.

---

## Setup

### Prerequisites
- **Node.js LTS** (20+)
- **Git**
- On Windows: **Developer Mode** enabled if you intend to run `npm run dist:win` locally
  (so electron-builder can extract its signing toolchain). See `RELEASE.md` for details.

### First-time
```bash
git clone <repo> ingestra-capturestudio
cd ingestra-capturestudio
npm install
npm run keygen:genkey       # one-time vendor key generation (Phase 8)
```

### Dev mode
```bash
npm run dev
```
Hot-reloads renderer + restarts main on TS changes. Opens DevTools detached.

### Test
```bash
npm test              # one-shot run (54 tests across 5 modules)
npm run test:watch    # watch mode
```

Tests cover:
- `ffmpeg-args.ts` — codec×container combos, fast-path detection, trim/scale, GIF palette.
- `filename-template.ts` — token expansion, sanitization, edge cases.
- `license-verify.ts` — signature verification (with a throwaway keypair), tampering / expired / unknown-tier rejection.
- `settings.schema.ts` — defaults, validation, partial patches.
- `ipc-channels.ts` — uniqueness + namespacing of channel/event names.

### Typecheck
```bash
npm run typecheck
```
Strict TypeScript in three projects: main, preload, renderer.

### Build
```bash
npm run build                    # bundles all three layers into out/
```
Includes a `prebuild` hook that auto-optimizes `assets/logo.png` into `src/renderer/src/assets/logo.png` (renderer use), `resources/icon.png` (window icon), and `resources/icon.ico` (Windows installer).

### Package
```bash
npm run dist            # current OS
npm run dist:win        # Windows NSIS installer
npm run dist:mac        # macOS DMG (must be on macOS)
npm run dist:linux      # Linux AppImage
```

### Release
```bash
npm run release         # build + sign + notarize + publish to GitHub Releases
```
See [`RELEASE.md`](./RELEASE.md) for the env vars + signing checklist.

---

## Vendor keys (Phase 8)

```bash
npm run keygen:genkey                              # one-time
npm run keygen:issue -- --tier pro --days 365      # issue a customer key
```

The private key lives only at `tools/keygen/keys/private.pem` (gitignored). The matching
public key is embedded in the app at `src/main/services/license-public-key.ts` so
verification is 100 % offline.

---

## File layout

```
src/
  shared/                  imported by all 3 layers; pure types + zod schemas
  main/
    index.ts               app bootstrap
    ipc/                   one *.handlers.ts per domain
    services/              business logic
    windows/               transparent overlay windows
  preload/                 contextBridge surface (only typed API exposed)
  renderer/
    index.html             main UI
    region-overlay.html    per-display selection overlay
    countdown.html         3-2-1 overlay
    drawing-overlay.html   in-recording drawing canvas
    src/features/          one folder per domain
tests/                     vitest, 5 suites, 54 tests
tools/
  keygen/                  vendor signing CLI
  build-assets/            logo optimizer
resources/                 icons + mac entitlements (built into installers)
.github/workflows/         release pipeline
```

---

## What's still rough or not production-ready

Prioritized (highest = most important to address before a public launch):

### High
1. **System-audio capture on macOS** is best-effort. We detect virtual loopback devices
   (BlackHole, Soundflower, Loopback Audio, VB-Audio, etc.) and use them, but if none
   is installed the user gets a "Mic only" fallback with an explainer. **There is no
   first-party solution** — Apple deliberately doesn't expose desktop loopback.
   *Fix: ship a notarized helper driver, or document BlackHole install as a prereq.*
2. **Local Windows packaging fails without Developer Mode** because electron-builder's
   `winCodeSign` archive contains macOS symlinks. Documented in `RELEASE.md` but causes
   a confusing first-build error. *Fix: ship our own extraction step that skips the
   `.dylib` symlinks, or require the user enable Developer Mode (current docs).*
3. **License rotation is risky.** Rotating the embedded public key invalidates every
   existing customer's key. There's no automatic re-keying path. *Fix: support multiple
   embedded public keys for a transition window during rotation.*

### Medium
4. **Bluetooth pen pressure data isn't accessible** through generic Web Bluetooth. Only
   button events work. Vendor-specific GATT decoders would let us add pressure
   sensitivity per pen. Adonit Note+ would be the natural first target.
5. **The drawing overlay is OS-window-level**, so anything that floats above
   `screen-saver` z-order (rare; some kiosk software does this) can occlude it.
6. **`safeStorage` on Linux requires libsecret / GNOME Keyring** — server / headless
   Linux fails license activation. Documented; mitigation is "use a desktop session".
7. **Hardware fingerprint changes on Windows after a clean OS reinstall** (new
   MachineGuid), forcing the customer to deactivate (if they still have access to the
   old install) or contact support for a re-issue.
8. **Doc export bundle size**: pdf-lib + docx add ~1.3 MB to the renderer bundle. They
   currently eager-load. Lazy-loading them only when the Library export is opened would
   trim the cold-start by ~600ms.

### Low
9. **No automatic Table of Contents** in PDF/DOCX doc export. Section headings already
   generate proper Word headings, so a Word TOC works manually (right-click "Update
   Field"). The PDF side would need custom page-number tracking.
10. **No drag-to-reorder via keyboard** in the Library doc-export dialog (mouse only).
11. **Annotator ops aren't editable after commit** — you can undo, but you can't
    select an existing op to move/resize/restyle.
12. **Annotator Clear is not undoable.** All other ops have undo / redo.
13. **Crash log rotation isn't implemented** — `userData/crash.log` grows unbounded.

### Cosmetic
14. **Doc export thumbnails in the dialog can hitch** if many videos are in Library;
    they're decoded lazily but the IntersectionObserver isn't tuned.
15. **Light theme contrast** is good but not WCAG AAA on every surface. Several
    `rgba()` based borders fall slightly below 4.5:1.

---

## License

App source: UNLICENSED (private). Customer license keys (for end users) are governed by
the offline Ed25519 system documented in [`tools/keygen/README.md`](./tools/keygen/README.md).

---

## Acknowledgements

Built on the shoulders of: Electron, React, Vite, electron-vite, electron-builder,
electron-updater, ffmpeg (via ffmpeg-static), pdf-lib, docx, sharp, pdf-lib,
electron-store, zod, vitest. None of this app would be possible without those projects.
