// A minimal zip writer, for handing a markdown export and its diagrams over as
// one browser download.
//
// Written here rather than pulled in: the package ships zero runtime
// dependencies, and the format needed is small. Only what a reader must have is
// produced — a local header per entry, a central directory, an end record — with
// deflate from node:zlib, which is built in.
//
// Output is deterministic. Entries carry a fixed DOS timestamp unless a caller
// passes one, so the same input zips to the same bytes and a test can compare
// them without a clock in the way.

import { deflateRawSync } from 'node:zlib';

/** The DOS epoch (1980-01-01 00:00:00), as a (date, time) pair. */
const DOS_EPOCH = { date: (1 << 5) | 1, time: 0 };

let CRC_TABLE = null;

function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  CRC_TABLE = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    CRC_TABLE[n] = c;
  }
  return CRC_TABLE;
}

/** CRC-32 of a buffer, as an unsigned 32-bit integer. */
export function crc32(buf) {
  const table = crcTable();
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** Convert a Date into the DOS (date, time) pair zip entries carry. */
export function dosStamp(date) {
  if (!date) return DOS_EPOCH;
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime()) || d.getFullYear() < 1980) return DOS_EPOCH;
  return {
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
  };
}

/**
 * Build a zip archive.
 *
 * @param {{name:string, data:Buffer|string}[]} entries paths use forward slashes
 * @param {{modified?:Date|string}} [opts]
 * @returns {Buffer}
 */
export function zip(entries, opts = {}) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('zip: at least one entry is required');
  }
  const stamp = dosStamp(opts.modified);
  const locals = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const name = String(entry.name).replace(/\\/g, '/').replace(/^\/+/, '');
    if (!name) throw new Error('zip: an entry needs a name');
    // Zip slip. An entry named `../../x` writes outside the directory the
    // reviewer extracted into, and plenty of unzip implementations will do it.
    // Rejected rather than normalised: a caller passing one has a bug, and
    // quietly rewriting the path would hide it.
    if (name.split('/').some((part) => part === '..' || part === '.')) {
      throw new Error(`zip: entry name escapes the archive: ${name}`);
    }
    if (/^[a-zA-Z]:/.test(name)) throw new Error(`zip: entry name is absolute: ${name}`);
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), 'utf8');
    const deflated = deflateRawSync(data);
    // Deflate can grow incompressible input; storing it is then both smaller and
    // faster to read, and method 0 is as widely supported as method 8.
    const stored = deflated.length >= data.length;
    const payload = stored ? data : deflated;
    const method = stored ? 0 : 8;
    const sum = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra
    locals.push(local, nameBuf, payload);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4); // version made by
    dir.writeUInt16LE(20, 6); // version needed
    dir.writeUInt16LE(0, 8); // flags
    dir.writeUInt16LE(method, 10);
    dir.writeUInt16LE(stamp.time, 12);
    dir.writeUInt16LE(stamp.date, 14);
    dir.writeUInt32LE(sum, 16);
    dir.writeUInt32LE(payload.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt16LE(0, 30); // extra
    dir.writeUInt16LE(0, 32); // comment
    dir.writeUInt16LE(0, 34); // disk
    dir.writeUInt16LE(0, 36); // internal attrs
    dir.writeUInt32LE(0o644 << 16, 38); // external attrs: a regular file
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBuf);

    offset += local.length + nameBuf.length + payload.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4); // this disk
  end.writeUInt16LE(0, 6); // disk with the central directory
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...locals, centralBuf, end]);
}
