/**
 * Generates minimal fixture images for image.test.ts.
 *
 * Creates:
 *   tests/fixtures/sample.png   — 10×10 red RGB PNG (built from raw bytes)
 *   tests/fixtures/sample.jpg   — 10×10 JPEG derived from sample.png via Bun.Image
 *   tests/fixtures/sample.webp  — 10×10 WebP derived from sample.png via Bun.Image
 *
 * Run with: bun scripts/generate-image-fixtures.ts
 */

import { deflateSync } from "node:zlib";
import { join } from "node:path";

const FIXTURES = join(import.meta.dir, "..", "tests", "fixtures");

// ─── CRC-32 (IEEE 802.3 / PNG-compatible) ────────────────────────────────────

function buildCrc32Table(): Int32Array {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
}

const CRC32_TABLE = buildCrc32Table();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = (CRC32_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)) | 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ─── PNG builder ─────────────────────────────────────────────────────────────

function u32be(n: number): Uint8Array {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setUint32(0, n >>> 0, false);
  return buf;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  // CRC covers type + data
  const crcInput = new Uint8Array(typeBytes.length + data.length);
  crcInput.set(typeBytes);
  crcInput.set(data, typeBytes.length);
  const checksum = crc32(crcInput);

  const out = new Uint8Array(4 + 4 + data.length + 4);
  out.set(u32be(data.length), 0);
  out.set(typeBytes, 4);
  out.set(data, 8);
  out.set(u32be(checksum), 8 + data.length);
  return out;
}

function makePng(width: number, height: number, r: number, g: number, b: number): Uint8Array {
  // IHDR chunk data (13 bytes)
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB truecolor
  // bytes 10-12: compression=0, filter=0, interlace=0

  // Raw scanline data: each row = 1 filter byte (0=None) + width*3 RGB bytes
  const raw = new Uint8Array(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const base = y * (1 + width * 3);
    raw[base] = 0; // filter type: None
    for (let x = 0; x < width; x++) {
      raw[base + 1 + x * 3] = r;
      raw[base + 1 + x * 3 + 1] = g;
      raw[base + 1 + x * 3 + 2] = b;
    }
  }

  // zlib-compress the raw data (deflateSync produces RFC 1950 zlib stream)
  const compressed = deflateSync(raw, { level: 6 });

  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrChunk = pngChunk("IHDR", ihdr);
  const idatChunk = pngChunk("IDAT", compressed);
  const iendChunk = pngChunk("IEND", new Uint8Array(0));

  const total = sig.length + ihdrChunk.length + idatChunk.length + iendChunk.length;
  const png = new Uint8Array(total);
  let offset = 0;
  png.set(sig, offset);
  offset += sig.length;
  png.set(ihdrChunk, offset);
  offset += ihdrChunk.length;
  png.set(idatChunk, offset);
  offset += idatChunk.length;
  png.set(iendChunk, offset);
  return png;
}

// ─── Generate fixtures ────────────────────────────────────────────────────────

const pngPath = join(FIXTURES, "sample.png");
const jpgPath = join(FIXTURES, "sample.jpg");
const webpPath = join(FIXTURES, "sample.webp");

// 1. Write sample.png (10×10 red)
const pngBytes = makePng(10, 10, 255, 99, 71);
await Bun.write(pngPath, pngBytes);

// Verify it parses correctly before proceeding
const meta = await Bun.file(pngPath).image().metadata();
if (meta.width !== 10 || meta.height !== 10 || meta.format !== "png") {
  throw new Error(`sample.png validation failed: ${JSON.stringify(meta)}`);
}
console.log(`✓ sample.png  (${pngBytes.length} bytes, ${meta.width}×${meta.height} ${meta.format})`);

// 2. Derive sample.jpg from sample.png via Bun.Image
const jpgBytes = await Bun.file(pngPath).image().jpeg({ quality: 80 }).bytes();
await Bun.write(jpgPath, jpgBytes);
const jpgMeta = await Bun.file(jpgPath).image().metadata();
console.log(`✓ sample.jpg  (${jpgBytes.length} bytes, ${jpgMeta.width}×${jpgMeta.height} ${jpgMeta.format})`);

// 3. Derive sample.webp from sample.png via Bun.Image
const webpBytes = await Bun.file(pngPath).image().webp({ quality: 80 }).bytes();
await Bun.write(webpPath, webpBytes);
const webpMeta = await Bun.file(webpPath).image().metadata();
console.log(`✓ sample.webp (${webpBytes.length} bytes, ${webpMeta.width}×${webpMeta.height} ${webpMeta.format})`);

console.log("\nDone. Fixture images written to tests/fixtures/");
