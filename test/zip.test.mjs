// The zip writer. The real check is the last one: a system `unzip` has to accept
// what we produce, because the consumer is whatever the reviewer has installed,
// not our own reader.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { zip, crc32, dosStamp } from '../lib/zip.mjs';

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'sf-zip-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const hasUnzip = spawnSync('unzip', ['-v']).status === 0;

test('crc32 matches the known vector', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  assert.equal(crc32(Buffer.from('')), 0);
});

test('the archive carries the zip signatures in order', () => {
  const buf = zip([{ name: 'a.txt', data: 'hello' }]);
  assert.equal(buf.readUInt32LE(0), 0x04034b50, 'a local file header first');
  assert.ok(buf.includes(Buffer.from([0x50, 0x4b, 0x01, 0x02])), 'a central directory entry');
  const end = buf.length - 22;
  assert.equal(buf.readUInt32LE(end), 0x06054b50, 'the end record last');
  assert.equal(buf.readUInt16LE(end + 8), 1, 'one entry');
});

test('entry names are normalised to forward slashes with no leading slash', () => {
  const buf = zip([{ name: '/spec.assets\\d-1.svg', data: '<svg/>' }]);
  assert.ok(buf.includes(Buffer.from('spec.assets/d-1.svg')));
  assert.ok(!buf.includes(Buffer.from('/spec.assets')), 'an absolute path would extract outside the target');
});

test('an entry name that escapes the archive is refused', () => {
  // Zip slip: plenty of extractors happily write outside the target directory,
  // so the archive must not contain the path in the first place. Refused rather
  // than rewritten, because a caller passing one has a bug worth seeing.
  for (const name of [
    '../escape.svg',
    'a/../../escape.svg',
    'spec.assets/../../escape.svg',
    '..\\escape.svg',
    './escape.svg',
    'C:/windows/x.svg',
  ]) {
    assert.throws(() => zip([{ name, data: 'x' }]), /escapes the archive|is absolute/, name);
  }

  // A legitimate nested path is still fine.
  assert.ok(zip([{ name: 'spec.assets/deep/d-1.svg', data: 'x' }]).includes(Buffer.from('spec.assets/deep/d-1.svg')));
});

test('data deflate would grow is stored instead', () => {
  // One byte: deflate adds framing that costs more than the byte itself, so the
  // stored branch is taken. Deterministic, unlike hoping a buffer is random
  // enough — a repeating pattern deflates well however arbitrary it looks.
  const buf = zip([{ name: 'r.bin', data: Buffer.from([0x42]) }]);
  assert.equal(buf.readUInt16LE(8), 0, 'method 0: stored');
  assert.equal(buf.readUInt32LE(18), 1, 'compressed size is the byte itself');
  assert.equal(buf.readUInt32LE(22), 1, 'uncompressed size agrees');
});

test('compressible data is deflated', () => {
  const buf = zip([{ name: 'a.txt', data: 'x'.repeat(4096) }]);
  assert.equal(buf.readUInt16LE(8), 8, 'method 8: deflate');
  assert.ok(buf.length < 1024);
});

test('the output is deterministic without a timestamp', () => {
  const a = zip([{ name: 'a.txt', data: 'hello' }]);
  const b = zip([{ name: 'a.txt', data: 'hello' }]);
  assert.deepEqual(a, b, 'the same input zips to the same bytes');
});

test('a supplied timestamp is encoded, and a pre-1980 one falls back', () => {
  const stamp = dosStamp(new Date('2026-08-14T10:30:00Z'));
  assert.equal(stamp.date >> 9, 46, 'years since 1980');
  assert.deepEqual(dosStamp(new Date('1970-01-01')), dosStamp(null), 'the DOS epoch cannot hold it');
  assert.deepEqual(dosStamp('not a date'), dosStamp(null));
});

test('an empty entry list is refused', () => {
  assert.throws(() => zip([]), /at least one entry/);
  assert.throws(() => zip([{ name: '', data: 'x' }]), /needs a name/);
});

test('unzip accepts the archive and the contents come back byte for byte', { skip: !hasUnzip }, () => {
  const md = '# Doc\n\n![d](spec.assets/d-1.svg)\n';
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>\n';
  const path = join(dir, 'out.zip');
  writeFileSync(path, zip([
    { name: 'spec.md', data: md },
    { name: 'spec.assets/d-1.svg', data: svg },
  ]));

  const test_ = spawnSync('unzip', ['-t', path], { encoding: 'utf8' });
  assert.equal(test_.status, 0, `unzip -t reported: ${test_.stdout}${test_.stderr}`);
  assert.match(test_.stdout, /No errors detected/);

  const out = join(dir, 'x');
  assert.equal(spawnSync('unzip', ['-q', path, '-d', out]).status, 0);
  assert.ok(existsSync(join(out, 'spec.assets', 'd-1.svg')), 'the directory structure survived');
  assert.equal(readFileSync(join(out, 'spec.md'), 'utf8'), md);
  assert.equal(readFileSync(join(out, 'spec.assets', 'd-1.svg'), 'utf8'), svg);
});
