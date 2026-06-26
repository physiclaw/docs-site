// Tiny in-memory ZIP writer — no external `zip` CLI needed. Shared by the release
// repackager (scripts/fetch-release.mjs) and the gallery optimizer
// (scripts/optimize-gallery.mjs). Node's `zlib.crc32` (Node ≥ 20.15 / 22.2) supplies
// the per-entry checksum. Standard (non-ZIP64) format — fine for our small archives.

import { deflateRawSync, crc32 } from 'node:zlib';

/**
 * Build a ZIP archive in memory. Each entry is stored DEFLATE-compressed, or
 * uncompressed when deflate wouldn't shrink it (e.g. already-compressed webp) —
 * so text like STEP files still compresses, but media isn't re-deflated for nothing.
 * @param {Array<{ name: string, data: Buffer }>} entries
 * @returns {Buffer}
 */
export function buildZip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data) >>> 0;
    const deflated = deflateRawSync(data);
    // method 8 = deflate, 0 = stored. Keep whichever is smaller.
    const stored = deflated.length >= data.length;
    const method = stored ? 0 : 8;
    const payload = stored ? data : deflated;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0, 10); // mod time + date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    parts.push(local, nameBuf, payload);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); // central directory header signature
    cd.writeUInt16LE(20, 4); // version made by
    cd.writeUInt16LE(20, 6); // version needed
    cd.writeUInt16LE(0, 8); // flags
    cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(0, 12); // mod time + date
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(payload.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30); // extra length
    cd.writeUInt16LE(0, 32); // comment length
    cd.writeUInt16LE(0, 34); // disk number start
    cd.writeUInt16LE(0, 36); // internal attrs
    cd.writeUInt32LE(0, 38); // external attrs
    cd.writeUInt32LE(offset, 42); // local header offset
    central.push(cd, nameBuf);

    offset += local.length + nameBuf.length + payload.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  eocd.writeUInt16LE(entries.length, 8); // entries on this disk
  eocd.writeUInt16LE(entries.length, 10); // total entries
  eocd.writeUInt32LE(centralBuf.length, 12); // central dir size
  eocd.writeUInt32LE(offset, 16); // central dir offset
  return Buffer.concat([...parts, centralBuf, eocd]);
}
