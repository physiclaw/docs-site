import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import {
  parseHardwareVersion,
  compareVersions,
  pickLatestRelease,
  isAscii,
  rewriteCustomPartsLink,
  buildZip,
  CUSTOM_PARTS_URL,
} from './fetch-release.mjs';

test('parseHardwareVersion accepts only hardware tags', () => {
  assert.deepEqual(parseHardwareVersion('physiclaw-hardware-v0.2'), [0, 2]);
  assert.deepEqual(parseHardwareVersion('physiclaw-hardware-v1.10.3'), [1, 10, 3]);
  assert.equal(parseHardwareVersion('physiclaw-software-v1.0'), null);
  assert.equal(parseHardwareVersion('v0.2'), null);
  assert.equal(parseHardwareVersion('physiclaw-hardware-vbeta'), null);
  assert.equal(parseHardwareVersion(undefined), null);
});

test('compareVersions orders numerically, zero-pads', () => {
  assert.ok(compareVersions([0, 2], [0, 1]) > 0);
  assert.ok(compareVersions([0, 10], [0, 9]) > 0); // not lexical
  assert.ok(compareVersions([1, 0], [0, 9]) > 0);
  assert.equal(compareVersions([0, 2], [0, 2, 0]), 0);
  assert.ok(compareVersions([0, 1], [0, 2]) < 0);
});

test('pickLatestRelease picks highest hardware version, skips drafts/prereleases/non-hardware', () => {
  const releases = [
    { tag_name: 'physiclaw-hardware-v0.1' },
    { tag_name: 'physiclaw-hardware-v0.2' },
    { tag_name: 'physiclaw-hardware-v0.10' }, // newest
    { tag_name: 'physiclaw-hardware-v0.3', draft: true },
    { tag_name: 'physiclaw-hardware-v0.4', prerelease: true },
    { tag_name: 'physiclaw-software-v9.0' },
  ];
  assert.equal(pickLatestRelease(releases).tag_name, 'physiclaw-hardware-v0.10');
});

test('pickLatestRelease can opt into prereleases', () => {
  const releases = [
    { tag_name: 'physiclaw-hardware-v0.2' },
    { tag_name: 'physiclaw-hardware-v0.3', prerelease: true },
  ];
  assert.equal(pickLatestRelease(releases, { allowPrerelease: true }).tag_name, 'physiclaw-hardware-v0.3');
});

test('pickLatestRelease returns null when nothing matches', () => {
  assert.equal(pickLatestRelease([{ tag_name: 'random-v1' }]), null);
  assert.equal(pickLatestRelease([]), null);
});

test('isAscii distinguishes English filename from 中文', () => {
  assert.equal(isAscii('physiclaw_manual.html'), true);
  assert.equal(isAscii('physiclaw装配手册.html'), false);
});

test('rewriteCustomPartsLink retargets any pinned tag to the served path', () => {
  const html =
    '<a href="https://github.com/physiclaw/PhysiClaw/releases/download/physiclaw-hardware-v0.1/physiclaw_custom_parts.zip">parts</a>';
  const out = rewriteCustomPartsLink(html);
  assert.ok(out.includes(`href="${CUSTOM_PARTS_URL}"`));
  assert.ok(!out.includes('releases/download'));
});

test('rewriteCustomPartsLink works for a future tag and leaves other links alone', () => {
  const html =
    '<a href="https://github.com/physiclaw/PhysiClaw/releases/download/physiclaw-hardware-v2.5/physiclaw_custom_parts.zip">p</a>' +
    '<a href="https://item.taobao.com/item.htm?id=123">buy</a>';
  const out = rewriteCustomPartsLink(html);
  assert.ok(out.includes(`href="${CUSTOM_PARTS_URL}"`));
  assert.ok(out.includes('https://item.taobao.com/item.htm?id=123'));
});

test('buildZip produces a valid single-entry archive that round-trips', () => {
  const data = Buffer.from('solid model — '.repeat(500), 'utf8');
  const zip = buildZip([{ name: 'physiclaw_assembly_3d.step', data }]);

  // Local file header + End of central directory signatures.
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
  assert.ok(zip.includes(Buffer.from('physiclaw_assembly_3d.step')));

  // The stored deflate stream inflates back to the original bytes.
  const nameLen = zip.readUInt16LE(26);
  const compLen = zip.readUInt32LE(18);
  const start = 30 + nameLen;
  const restored = inflateRawSync(zip.subarray(start, start + compLen));
  assert.deepEqual(restored, data);
});
