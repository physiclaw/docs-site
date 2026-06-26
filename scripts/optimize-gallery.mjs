#!/usr/bin/env node
// One-time, LOCAL gallery optimizer — NOT part of the build.
//
// The hardware gallery originals are ~80 full-res phone photos (a few hundred MB of JPEG).
// Downloading and webp-encoding all of that on every CI deploy would be wasteful
// (network + compute) and risk Cloudflare Pages' build limits. So we optimize ONCE
// here and ship the small result through the release: the build then just downloads
// (~20MB) and unzips it, with no image processing.
//
// This script:
//   1. reads the source photos (sorted),
//   2. writes a matched webp pair per photo —
//        src/assets/gallery/full/gallery_NN.webp    (≤ FULL px, the lightbox image)
//        src/assets/gallery/thumb/gallery_NN.webp   (≤ THUMB px, the grid thumbnail)
//      so you can build/preview locally right away, and
//   3. packs that thumb/ + full/ tree into ./physiclaw_hardware_gallery.zip.
//
// Then upload that zip to the `physiclaw-hardware-gallery` GitHub release (replacing
// the `physiclaw_hardware_gallery.zip` asset). scripts/fetch-release.mjs downloads and
// unzips it at build time (see fetchGallery). EXIF orientation is baked in; images are
// never upscaled.
//
// Usage:
//   node scripts/optimize-gallery.mjs [sourceDir]
//   GALLERY_SRC=/path/to/originals node scripts/optimize-gallery.mjs
// Default sourceDir: ~/Downloads/physiclaw_images/images

import sharp from 'sharp';
import { readdir, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { buildZip } from './zip.mjs';

const FULL = 2000; // longest edge of the lightbox image
const THUMB = 900; // longest edge of the grid thumbnail
const QUALITY = 80;
const SOURCE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff']);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src', 'assets', 'gallery');
const ZIP_OUT = join(ROOT, 'physiclaw_hardware_gallery.zip');

const src =
  process.argv[2] ||
  process.env.GALLERY_SRC ||
  join(homedir(), 'Downloads', 'physiclaw_images', 'images');

async function main() {
  try {
    await stat(src);
  } catch {
    console.error(`✗ optimize-gallery: source dir not found: ${src}`);
    console.error('  Pass it as an argument or set GALLERY_SRC.');
    process.exit(1);
  }

  const files = (await readdir(src))
    .filter((f) => SOURCE_EXT.has(extname(f).toLowerCase()))
    .sort();
  if (files.length === 0) {
    console.error(`✗ optimize-gallery: no images found in ${src}`);
    process.exit(1);
  }

  // Wipe + recreate so removed/renamed source photos don't leave stale output.
  await rm(OUT, { recursive: true, force: true });
  await mkdir(join(OUT, 'full'), { recursive: true });
  await mkdir(join(OUT, 'thumb'), { recursive: true });

  const pad = String(files.length).length;
  const entries = [];

  for (let i = 0; i < files.length; i++) {
    const name = `gallery_${String(i + 1).padStart(pad, '0')}.webp`;
    // .rotate() with no args bakes EXIF orientation into the pixels.
    const base = sharp(join(src, files[i])).rotate();
    const encode = (edge) =>
      base
        .clone()
        .resize(edge, edge, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: QUALITY })
        .toBuffer();

    const [full, thumb] = await Promise.all([encode(FULL), encode(THUMB)]);
    await Promise.all([
      writeFile(join(OUT, 'full', name), full),
      writeFile(join(OUT, 'thumb', name), thumb),
    ]);
    entries.push({ name: `full/${name}`, data: full }, { name: `thumb/${name}`, data: thumb });
  }

  await writeFile(ZIP_OUT, buildZip(entries));
  const totalMb = (entries.reduce((n, e) => n + e.data.length, 0) / 1024 / 1024).toFixed(1);
  console.log(`✓ optimize-gallery: ${files.length} photos → src/assets/gallery/ (${totalMb}MB)`);
  console.log(`✓ optimize-gallery: packed → ${ZIP_OUT}`);
  console.log(
    '  Next: upload that zip to the physiclaw-hardware-gallery release\n' +
      '  (replace the physiclaw_hardware_gallery.zip asset). Builds fetch it from there.',
  );
}

main().catch((err) => {
  console.error(`✗ optimize-gallery: ${err.message}`);
  process.exit(1);
});
