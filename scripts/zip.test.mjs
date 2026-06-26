import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { buildZip } from './zip.mjs';

test('buildZip deflates compressible data and round-trips', () => {
  const data = Buffer.from('solid model — '.repeat(500), 'utf8');
  const zip = buildZip([{ name: 'physiclaw_assembly_3d.step', data }]);

  // Local file header + End of central directory signatures.
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
  assert.ok(zip.includes(Buffer.from('physiclaw_assembly_3d.step')));

  assert.equal(zip.readUInt16LE(8), 8); // method: deflate (compressible)
  const nameLen = zip.readUInt16LE(26);
  const compLen = zip.readUInt32LE(18);
  const start = 30 + nameLen;
  assert.deepEqual(inflateRawSync(zip.subarray(start, start + compLen)), data);
});

test('buildZip stores (no deflate) when compression would not shrink', () => {
  // High-entropy bytes (xorshift32) don't compress — should be stored verbatim.
  let x = 0x9e3779b9;
  const data = Buffer.alloc(4096);
  for (let i = 0; i < data.length; i++) {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5;
    x >>>= 0;
    data[i] = x & 0xff;
  }
  const zip = buildZip([{ name: 'noise.bin', data }]);

  const nameLen = zip.readUInt16LE(26);
  const compLen = zip.readUInt32LE(18);
  const start = 30 + nameLen;
  assert.equal(zip.readUInt16LE(8), 0); // method: stored
  assert.equal(compLen, data.length); // not compressed
  assert.deepEqual(zip.subarray(start, start + compLen), data);
});

test('buildZip writes multiple entries', () => {
  const zip = buildZip([
    { name: 'full/gallery_01.webp', data: Buffer.from('aaaa') },
    { name: 'thumb/gallery_01.webp', data: Buffer.from('bbbb') },
  ]);
  assert.equal(zip.readUInt16LE(zip.length - 22 + 10), 2); // total entries in EOCD
  assert.ok(zip.includes(Buffer.from('full/gallery_01.webp')));
  assert.ok(zip.includes(Buffer.from('thumb/gallery_01.webp')));
});
