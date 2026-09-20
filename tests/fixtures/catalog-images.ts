import sharp from "sharp";
export function pngChunk(type: string, data: Buffer) {
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length, 0); result.write(type, 4, 4, "ascii"); data.copy(result, 8);
  let crc = 0xffffffff;
  for (const b of result.subarray(4, -4)) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
  return result;
}
export async function png(width = 32, height = 24, color = "#996633") {
  return sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();
}
export async function apng() {
  const base = await png();
  const chunks: { type: string; data: Buffer; bytes: Buffer }[] = [];
  for (let offset = 8; offset < base.length;) {
    const n = base.readUInt32BE(offset);
    chunks.push({ type: base.toString("ascii", offset + 4, offset + 8), data: base.subarray(offset + 8, offset + 8 + n), bytes: base.subarray(offset, offset + 12 + n) });
    offset += n + 12;
  }
  const control = Buffer.alloc(8); control.writeUInt32BE(2);
  const frame = (sequence: number) => {
    const data = Buffer.alloc(26);
    data.writeUInt32BE(sequence); data.writeUInt32BE(32, 4); data.writeUInt32BE(24, 8);
    data.writeUInt16BE(1, 20); data.writeUInt16BE(10, 22);
    return pngChunk("fcTL", data);
  };
  const data = Buffer.concat(chunks.filter(c => c.type === "IDAT").map(c => c.data));
  const fd = Buffer.alloc(data.length + 4); fd.writeUInt32BE(2); data.copy(fd, 4);
  return Buffer.concat([base.subarray(0, 8), chunks.find(c => c.type === "IHDR")!.bytes, pngChunk("acTL", control), frame(0),
    ...chunks.filter(c => !["IHDR", "IDAT", "IEND"].includes(c.type)).map(c => c.bytes),
    ...chunks.filter(c => c.type === "IDAT").map(c => c.bytes), frame(1), pngChunk("fdAT", fd), chunks.find(c => c.type === "IEND")!.bytes]);
}
