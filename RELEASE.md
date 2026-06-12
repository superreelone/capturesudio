# Releasing Ingestra-CaptureStudio

A signed, notarized, auto-updating release in one command per platform. The pipeline
relies on environment variables for credentials — **no certificates or secrets live in
the repo**.

## Channels

The app reads its update feed from `electron-builder.yml` (`publish.provider: github`).
Stable users get GitHub Releases tagged `latest`; you can switch to `beta`/`alpha`
channels later by changing the version suffix (`-beta.1`, `-alpha.1`).

---

## One-time vendor setup

### 1. Bake your signing public key into the app

```bash
npm run keygen:genkey      # only once. Writes tools/keygen/keys/private.pem + embeds the public key
```

This produces vendor license keys and is **independent** of code-signing certs.

### 2. Windows code-signing certificate

You need an Authenticode certificate from a CA (DigiCert, Sectigo, SSL.com, GlobalSign,
Certum, etc.). For 2024+ regulations this must be on a hardware token or use a cloud
signing service (Azure Trusted Signing, SSL.com eSigner).

For **file-based .pfx** (older flow):

| Env var | Value |
|---|---|
| `CSC_LINK` | Absolute path to your `.pfx`/`.p12` (or HTTPS URL) |
| `CSC_KEY_PASSWORD` | Password for the certificate |

For **Azure Trusted Signing** (recommended for new certs):

| Env var | Value |
|---|---|
| `AZURE_TENANT_ID` | Your Azure tenant id |
| `AZURE_CLIENT_ID` | App-registration client id |
| `AZURE_CLIENT_SECRET` | App-registration secret |
| `AZURE_CODE_SIGN_ACCOUNT_NAME` | Trusted Signing account name |
| `AZURE_CODE_SIGN_PROFILE_NAME` | Trusted Signing profile name |

Then point `win.signtoolOptions` in `electron-builder.yml` at the Azure plugin — happy
to wire this in when you get to it.

### 3. macOS Developer ID + notarization

Get an **Apple Developer Program** account, then in the Apple Developer portal:

1. Create a **Developer ID Application** certificate. Install it in your macOS keychain.
2. Create an **app-specific password** at appleid.apple.com → Sign-In and Security →
   App-Specific Passwords. Label it "electron-builder notarization".
3. Note your **Team ID** (10 hex chars) from the Membership page.

Then set:

| Env var | Value |
|---|---|
| `APPLE_ID` | Your Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | The app-specific password from step 2 |
| `APPLE_TEAM_ID` | Your 10-char Team ID |
| `CSC_KEYCHAIN` *(optional)* | Path to a custom keychain. Default uses login.keychain. |

electron-builder picks these up automatically when you set `mac.notarize: true` (or
detect them via env presence).

### 4. GitHub Release publishing

| Env var | Value |
|---|---|
| `GH_TOKEN` | A Personal Access Token with `repo` scope (or `public_repo` for public repos) |

For CI, use a fine-scoped GitHub Actions token via `${{ secrets.GH_TOKEN }}`.

---

## Cutting a release

### Local (developer machine)

```bash
# 1. Pick a version. Don't skip semver — auto-update relies on it.
npm version patch        # or minor / major

# 2. Build the platform you're on, sign, notarize, and publish.
# Windows:
$env:CSC_LINK = "C:\path\to\cert.pfx"
$env:CSC_KEY_PASSWORD = "..."
$env:GH_TOKEN = "..."
npm run release

# macOS:
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="abcd-efgh-ijkl-mnop"
export APPLE_TEAM_ID="ABCD123456"
export GH_TOKEN="..."
npm run release

# Linux (no signing typically — AppImage is unsigned):
GH_TOKEN="..." npm run release
```

That's it. The artifacts upload to GitHub Releases; existing installed users will see
the **Update available** banner inside the app within ~8 seconds of next launch.

### Just build, don't publish

```bash
npm run dist            # produces unsigned installers in dist/ for your current OS
npm run dist:win        # explicit Windows
npm run dist:mac        # explicit macOS (must be on macOS)
npm run dist:linux      # explicit Linux
```

These run `electron-builder` without the `--publish always` flag, so nothing is uploaded.
Useful for QA builds and reproducing user issues.

---

## Pre-release checklist

- [ ] `git status` clean on `main` branch.
- [ ] `package.json` version bumped (`npm version patch|minor|major`).
- [ ] `CHANGELOG.md` updated (top entry: new version + notes; these become the update
      banner's "release notes").
- [ ] `npm run typecheck` and `npm run build` both pass.
- [ ] Manually verify a critical path on each platform (record → export → check file).
- [ ] If the license public key changed, **don't ship** — that'd brick every existing
      customer until they re-activate. Public key changes need a coordinated rollout.

---

## CI release on git tag (GitHub Actions)

The included `.github/workflows/release.yml` builds + publishes when you push a tag
matching `v*.*.*`. Set these GitHub Actions secrets:

| Secret | When needed |
|---|---|
| `GH_TOKEN` | Always |
| `CSC_LINK_BASE64` | Windows (base64-encoded .pfx) |
| `CSC_KEY_PASSWORD` | Windows |
| `APPLE_ID` | macOS notarize |
| `APPLE_APP_SPECIFIC_PASSWORD` | macOS notarize |
| `APPLE_TEAM_ID` | macOS notarize |
| `CSC_LINK_MAC_BASE64` | macOS (base64-encoded Developer ID cert) |

Trigger a release:

```bash
git tag v1.0.0
git push origin v1.0.0
```

The workflow runs three matrix jobs in parallel (windows-latest / macos-latest /
ubuntu-latest), produces signed installers, and uploads them to a draft GitHub Release.
Publish the draft when you've verified the artifacts.

---

## Troubleshooting

- **Windows local build fails with**
  `Cannot create symbolic link : A required privilege is not held by the client.` →
  electron-builder tries to extract `winCodeSign.7z` which contains macOS `.dylib`
  symlinks. Windows only allows symlinks for admins, or with **Developer Mode**
  enabled. Three fixes, pick one:
  1. *Settings → Privacy & security → For developers* → enable **Developer Mode**,
     restart your terminal, retry.
  2. Run the build in an **Administrator** PowerShell.
  3. **No-admin workaround** — pre-populate the cache with a symlink-skipped
     extraction:
     ```bash
     rm -rf ~/AppData/Local/electron-builder/Cache/winCodeSign/*
     curl -L -o /tmp/winCodeSign.7z https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-2.6.0/winCodeSign-2.6.0.7z
     mkdir -p ~/AppData/Local/electron-builder/Cache/winCodeSign/winCodeSign-2.6.0
     ./node_modules/7zip-bin/win/x64/7za.exe x /tmp/winCodeSign.7z \
       "-oC:\Users\$USERNAME\AppData\Local\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0" \
       "-xr!libcrypto.dylib" "-xr!libssl.dylib" -y
     npm run dist:win
     ```
     The skipped files are macOS dylib symlinks that the Windows installer never
     needs. Cache survives between runs; only re-do this if you wipe the cache.

  CI runners (`windows-latest` on GitHub Actions) are not affected — they run with
  the privileges needed to create symlinks.

- **macOS build fails on Windows host** with
  `Build for macOS is supported only on macOS` → expected. Mac DMGs must be built
  on a macOS host because the signing toolchain depends on macOS-only binaries.
  Use the GitHub Actions release workflow (`.github/workflows/release.yml`) which
  has a `macos-latest` matrix job, or build locally on a Mac with `npm run dist:mac`.

- **`ENOENT: no such file or directory icon.ico`** → `npm run assets:optimize` first
  (the `prebuild` hook handles this in clean checkouts).
- **Notarization rejected (`A required parameter is missing`)** → check that all three
  `APPLE_*` env vars are present and the cert is "Developer ID Application", not
  "Developer ID Installer".
- **Windows installer fires Defender SmartScreen warning** → that's normal for unsigned
  builds. Once your Authenticode signature has been used a few hundred times, SmartScreen
  builds trust automatically. EV certs skip this delay.
- **App says "Update not available" but a newer version exists on GitHub** → the version
  on GitHub must be greater than the installed app's `package.json` version per semver.
  Also: the release must be marked **Published** (not Draft).
- **Auto-update silently fails in dev** → intentional. `setupAutoUpdater()` no-ops when
  `app.isPackaged === false`. Test updates in real packaged builds.
