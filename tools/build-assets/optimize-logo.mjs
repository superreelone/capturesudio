#!/usr/bin/env node
/**
 * Logo asset optimizer (build-time).
 *
 *   Master:   assets/logo.png                    (your authoring source — untouched)
 *   Renderer: src/renderer/src/assets/logo.png   (~256 px, palette PNG, ~50–150 KB)
 *   Window:   resources/icon.png                  (~512 px, full-color, sharp)
 *
 * Each output is rebuilt only if the master is newer than the existing output
 * (or the output is missing).
 *
 * `sharp` is a build-time devDependency — it is NEVER bundled into the app.
 */

import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

const MASTER = join(ROOT, 'assets', 'logo.png');

const TARGETS = [
  {
    path: join(ROOT, 'src', 'renderer', 'src', 'assets', 'logo.png'),
    size: 256,
    palette: true,
    quality: 85
  },
  {
    path: join(ROOT, 'resources', 'icon.png'),
    size: 512,
    palette: false
  }
];

// .ico for Windows installer / executable. Multi-resolution embedded.
const ICO_TARGET = join(ROOT, 'resources', 'icon.ico');
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

function rel(p) {
  return relative(ROOT, p).replaceAll('\\', '/');
}

function fmtKb(bytes) {
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function needsRebuild(master, output) {
  if (!existsSync(output)) return true;
  return statSync(master).mtimeMs > statSync(output).mtimeMs;
}

async function build(target, masterStat) {
  mkdirSync(dirname(target.path), { recursive: true });

  let pipe = sharp(MASTER).resize(target.size, target.size, {
    fit: 'contain',
    background: { r: 255, g: 255, b: 255, alpha: 0 }
  });

  if (target.palette) {
    pipe = pipe.png({
      quality: target.quality ?? 85,
      compressionLevel: 9,
      palette: true,
      effort: 10
    });
  } else {
    pipe = pipe.png({ compressionLevel: 9, effort: 10 });
  }

  await pipe.toFile(target.path);

  const out = statSync(target.path);
  const reduction = ((1 - out.size / masterStat.size) * 100).toFixed(1);
  console.log(
    `  ✓ ${rel(target.path).padEnd(40)} ${fmtKb(out.size).padStart(8)}  (-${reduction}% vs master)`
  );
}

async function buildIco(masterStat) {
  mkdirSync(dirname(ICO_TARGET), { recursive: true });
  // Render the master at each size then ask png-to-ico to merge them.
  const buffers = await Promise.all(
    ICO_SIZES.map((s) =>
      sharp(MASTER)
        .resize(s, s, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
        .png({ compressionLevel: 9 })
        .toBuffer()
    )
  );
  const ico = await pngToIco(buffers);
  writeFileSync(ICO_TARGET, ico);
  const out = statSync(ICO_TARGET);
  const reduction = ((1 - out.size / masterStat.size) * 100).toFixed(1);
  console.log(
    `  ✓ ${rel(ICO_TARGET).padEnd(40)} ${fmtKb(out.size).padStart(8)}  (-${reduction}% vs master)`
  );
}

async function main() {
  if (!existsSync(MASTER)) {
    console.error(`✗ master logo not found: ${rel(MASTER)}`);
    console.error('  Drop your authoring PNG at assets/logo.png and re-run.');
    process.exit(1);
  }
  const masterStat = statSync(MASTER);
  console.log(`◇ master  ${rel(MASTER).padEnd(40)} ${fmtKb(masterStat.size).padStart(8)}`);

  let built = 0;
  let upToDate = 0;
  for (const t of TARGETS) {
    if (!needsRebuild(MASTER, t.path)) {
      console.log(`  · ${rel(t.path).padEnd(40)} up-to-date`);
      upToDate++;
      continue;
    }
    await build(t, masterStat);
    built++;
  }
  // Rebuild the .ico if missing or stale.
  if (!needsRebuild(MASTER, ICO_TARGET)) {
    console.log(`  · ${rel(ICO_TARGET).padEnd(40)} up-to-date`);
    upToDate++;
  } else {
    await buildIco(masterStat);
    built++;
  }
  console.log(`◇ ${built} rebuilt, ${upToDate} up-to-date`);
}

main().catch((err) => {
  console.error('logo optimize failed:', err);
  process.exit(1);
});
