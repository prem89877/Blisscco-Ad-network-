// Test helper: chhoti, ASLI-jaisi image headers jinme sahi pixel dimensions hain (PNG IHDR, JPEG SOF0, WebP VP8X / VP8 / VP8L).
// Poori image nahi: dimension padhne wala code sirf header dekhta hai. Ye bytes kisi browser me render hone ke liye nahi hain.

const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const be16 = (n: number) => [(n >>> 8) & 255, n & 255];
const le16 = (n: number) => [n & 255, (n >>> 8) & 255];
const le24 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const pad = (bytes: number[], to = 64) => Uint8Array.from([...bytes, ...new Array(Math.max(0, to - bytes.length)).fill(0)]);

export function makePng(width: number, height: number) {
  return pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...be32(13), ...ascii("IHDR"), ...be32(width), ...be32(height), 8, 2, 0, 0, 0, 0, 0, 0, 0]);
}

export function makeJpeg(width: number, height: number) {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const sof0 = [0xff, 0xc0, 0x00, 0x11, 0x08, ...be16(height), ...be16(width), 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return pad([0xff, 0xd8, ...app0, ...sof0, 0xff, 0xd9]);
}

export function makeWebpExtended(width: number, height: number) {
  return pad([...ascii("RIFF"), ...be32(0), ...ascii("WEBP"), ...ascii("VP8X"), 10, 0, 0, 0, 0, 0, 0, 0, ...le24(width - 1), ...le24(height - 1)]);
}

export function makeWebpLossy(width: number, height: number) {
  return pad([...ascii("RIFF"), ...be32(0), ...ascii("WEBP"), ...ascii("VP8 "), 0, 0, 0, 0, 0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(width), ...le16(height)]);
}

export function makeWebpLossless(width: number, height: number) {
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
  return pad([...ascii("RIFF"), ...be32(0), ...ascii("WEBP"), ...ascii("VP8L"), 0, 0, 0, 0, 0x2f, bits & 255, (bits >>> 8) & 255, (bits >>> 16) & 255, (bits >>> 24) & 255]);
}
