// ZIP "store" records: PNG/JPEG are already compressed. Fixed entry names only.
// Bound well below ZIP64 limits; timestamps are fixed for reproducible downloads.
const table = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let value = i;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  table[i] = value >>> 0;
}
function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = table[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export function createZip(files: { name: string; bytes: Buffer }[]): Buffer {
  if (files.length > 32 || new Set(files.map(file => file.name)).size !== files.length) throw new Error("Invalid ZIP entry count");
  if (files.reduce((size, file) => size + file.bytes.length, 0) > 100 * 1024 * 1024) throw new Error("ZIP exceeds 100 MiB");
  const records: Buffer[] = [], directory: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    if (!/^[a-zA-Z0-9_./-]+$/.test(file.name) || file.name.startsWith("/") || file.name.split("/").some(part => !part || part === "." || part === "..")) throw new Error("Unsafe ZIP entry name");
    const name = Buffer.from(file.name), checksum = crc32(file.bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(33, 12); // 1980-01-01
    local.writeUInt32LE(checksum, 14); local.writeUInt32LE(file.bytes.length, 18); local.writeUInt32LE(file.bytes.length, 22); local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(33, 14); central.writeUInt32LE(checksum, 16); central.writeUInt32LE(file.bytes.length, 20); central.writeUInt32LE(file.bytes.length, 24);
    central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    records.push(local, name, file.bytes); directory.push(central, name);
    offset += local.length + name.length + file.bytes.length;
  }
  const size = directory.reduce((total, bytes) => total + bytes.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(size, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...records, ...directory, end]);
}
