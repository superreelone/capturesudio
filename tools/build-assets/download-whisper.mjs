/**
 * Download the whisper.cpp CLI binary for the current build platform and
 * place it under resources/whisper/<platform>/ so electron-builder can bundle
 * it via extraResources.
 *
 * Runs as part of `predist:win`/`predist:mac`/`predist:linux`. If the binary
 * is already present, this is a no-op. If the download fails (no network,
 * etc.), we emit a warning and continue — the build proceeds without the
 * captions runtime, and Settings → Captions reports it as missing.
 *
 * We pull from the official whisper.cpp release assets on GitHub. The asset
 * naming is stable for the pinned version; if upstream renames, bump
 * WHISPER_VERSION below and update the asset names accordingly.
 */

import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { tmpdir, platform as osPlatform, arch as osArch } from 'node:os';
import { get } from 'node:https';
import { pipeline } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';

const WHISPER_VERSION = '1.9.0';
const WHISPER_REPO = 'ggml-org/whisper.cpp';

const ROOT = resolvePath(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const RES = join(ROOT, 'resources', 'whisper');

const platform = osPlatform();
const arch = osArch();

/** Pick the right release asset for this build host. */
function pickAsset() {
  if (platform === 'win32' && arch === 'x64') {
    return {
      target: 'win',
      url: `https://github.com/${WHISPER_REPO}/releases/download/v${WHISPER_VERSION}/whisper-bin-x64.zip`,
      // Inside the zip the binary is named main.exe in older releases and
      // whisper-cli.exe in newer ones. We accept either.
      candidateBins: ['whisper-cli.exe', 'main.exe'],
      outBin: 'whisper-cli.exe',
      // ggml.dll, ggml-cpu.dll, etc. live next to the exe; copy them all.
      keepExtensions: ['.dll', '.exe', '.bin']
    };
  }
  // macOS and Linux builds need to be done on those platforms with the
  // whisper.cpp binary already built. We just create an empty dir so the
  // electron-builder extraResources glob doesn't fail; runtime checks
  // gracefully degrade.
  return null;
}

function downloadTo(url, dest, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const req = get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (redirectsLeft <= 0) {
          reject(new Error('too many redirects'));
          return;
        }
        res.resume();
        downloadTo(res.headers.location, dest, redirectsLeft - 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        res.resume();
        return;
      }
      const total = Number(res.headers['content-length'] ?? 0);
      let bytes = 0;
      let lastPct = -10;
      res.on('data', (c) => {
        bytes += c.length;
        if (total > 0) {
          const pct = Math.floor((bytes / total) * 100);
          if (pct - lastPct >= 5) {
            lastPct = pct;
            process.stdout.write(`  ↓ ${pct}%\r`);
          }
        }
      });
      const out = createWriteStream(dest);
      pipeline(res, out).then(resolve, reject);
    });
    req.on('error', reject);
  });
}

function extractZip(zipPath, outDir) {
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  // Use the bundled 7zip-bin we already depend on for winCodeSign.
  const sevenZip = join(ROOT, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');
  if (!existsSync(sevenZip)) {
    throw new Error(`7za.exe not found at ${sevenZip}`);
  }
  const r = spawnSync(sevenZip, ['x', zipPath, `-o${outDir}`, '-y'], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`7za.exe exit ${r.status}`);
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

async function main() {
  const asset = pickAsset();
  if (!asset) {
    console.log(`[download-whisper] no prebuilt binary for ${platform}/${arch}; skipping`);
    return;
  }
  const targetDir = join(RES, asset.target);
  const targetBin = join(targetDir, asset.outBin);
  if (existsSync(targetBin)) {
    console.log(`[download-whisper] already present at ${targetBin}; skipping`);
    return;
  }
  console.log(`[download-whisper] fetching v${WHISPER_VERSION} for ${asset.target}`);
  const tmp = join(tmpdir(), `whisper-${WHISPER_VERSION}-${asset.target}.zip`);
  try {
    await downloadTo(asset.url, tmp);
  } catch (err) {
    console.warn(`[download-whisper] download failed: ${err.message}`);
    console.warn(`[download-whisper] continuing build WITHOUT captions runtime — Settings → Captions will report it as missing.`);
    return;
  }
  console.log(`[download-whisper] downloaded; extracting…`);
  const extractDir = join(tmpdir(), `whisper-${WHISPER_VERSION}-${asset.target}`);
  try {
    extractZip(tmp, extractDir);
  } catch (err) {
    console.warn(`[download-whisper] extract failed: ${err.message}; skipping`);
    return;
  }

  if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });

  // Find the CLI binary and copy it plus its sibling DLLs alongside.
  const files = walk(extractDir);
  let foundBin = null;
  for (const candidate of asset.candidateBins) {
    foundBin = files.find((f) => f.toLowerCase().endsWith(candidate.toLowerCase()));
    if (foundBin) break;
  }
  if (!foundBin) {
    console.warn(`[download-whisper] couldn't find an expected binary inside the zip; aborting copy`);
    return;
  }
  const sourceDir = dirname(foundBin);
  const { copyFileSync } = await import('node:fs');
  for (const f of walk(sourceDir)) {
    const ext = f.slice(f.lastIndexOf('.'));
    if (!asset.keepExtensions.includes(ext.toLowerCase())) continue;
    const dest = join(targetDir, f.slice(sourceDir.length + 1));
    if (!existsSync(dirname(dest))) mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(f, dest);
  }
  // Rename the binary to whisper-cli.exe if it came as main.exe.
  if (!existsSync(targetBin)) {
    const mainExe = join(targetDir, 'main.exe');
    if (existsSync(mainExe)) {
      const { renameSync } = await import('node:fs');
      renameSync(mainExe, targetBin);
    }
  }
  console.log(`[download-whisper] installed at ${targetBin}`);
}

main().catch((err) => {
  console.error('[download-whisper] fatal:', err);
  // Don't fail the build — just log.
  process.exit(0);
});
