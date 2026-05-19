import { describe, test, expect, afterAll } from "bun:test";
import { join } from "node:path";
import { existsSync, unlinkSync } from "node:fs";

// ---------------------------------------------------------------------------
// Version guard — Bun.Image was introduced in 1.3.14
// ---------------------------------------------------------------------------

function semverGte(version: string, min: string): boolean {
  const [aMaj, aMin, aPatch] = version.split(".").map(Number);
  const [bMaj, bMin, bPatch] = min.split(".").map(Number);
  if (aMaj !== bMaj) return aMaj > bMaj;
  if (aMin !== bMin) return aMin > bMin;
  return aPatch >= bPatch;
}

const imageSupported = semverGte(Bun.version, "1.3.14");

// ---------------------------------------------------------------------------
// Fixture paths
// ---------------------------------------------------------------------------

const FIXTURES = join(import.meta.dir, "fixtures");
const JPG_FIXTURE = join(FIXTURES, "sample.jpg");
const PNG_FIXTURE = join(FIXTURES, "sample.png");
const WEBP_FIXTURE = join(FIXTURES, "sample.webp");
const TMP_OUTPUT = join(FIXTURES, "__image_test_output.tmp");

afterAll(() => {
  if (existsSync(TMP_OUTPUT)) unlinkSync(TMP_OUTPUT);
});

// ---------------------------------------------------------------------------
// Input construction
// ---------------------------------------------------------------------------

describe.if(imageSupported)("Bun.Image — Input", () => {
  test("construct from file path string", async () => {
    const img = new Bun.Image(PNG_FIXTURE);
    const meta = await img.metadata();
    expect(meta.width).toBeGreaterThan(0);
    expect(meta.height).toBeGreaterThan(0);
  });

  test("construct from Buffer / Uint8Array", async () => {
    const buf = await Bun.file(PNG_FIXTURE).bytes();
    const img = new Bun.Image(buf);
    const meta = await img.metadata();
    expect(meta.width).toBeGreaterThan(0);
    expect(meta.format).toBe("png");
  });

  test("construct from Bun.file()", async () => {
    const img = new Bun.Image(Bun.file(PNG_FIXTURE));
    const meta = await img.metadata();
    expect(meta.width).toBeGreaterThan(0);
  });

  test("Bun.file().image() shorthand matches new Bun.Image()", async () => {
    const a = await Bun.file(PNG_FIXTURE).image().metadata();
    const b = await new Bun.Image(Bun.file(PNG_FIXTURE)).metadata();
    expect(a.width).toBe(b.width);
    expect(a.height).toBe(b.height);
    expect(a.format).toBe(b.format);
  });

  test("options: maxPixels is accepted", async () => {
    const img = new Bun.Image(PNG_FIXTURE, { maxPixels: 4096 * 4096 });
    const meta = await img.metadata();
    expect(meta.width).toBeGreaterThan(0);
  });

  test("options: autoOrient is accepted", async () => {
    const img = new Bun.Image(PNG_FIXTURE, { autoOrient: true });
    const meta = await img.metadata();
    expect(meta.width).toBeGreaterThan(0);
  });

  test("maxPixels rejects input that exceeds the limit", async () => {
    // Fixture is 10×10 = 100 pixels; set limit below that
    const img = new Bun.Image(PNG_FIXTURE, { maxPixels: 1 });
    await expect(img.metadata()).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

describe.if(imageSupported)("Bun.Image — metadata()", () => {
  test("JPEG: returns correct width, height, and format", async () => {
    const { width, height, format } = await Bun.file(JPG_FIXTURE).image().metadata();
    expect(width).toBe(10);
    expect(height).toBe(10);
    expect(format).toBe("jpeg");
  });

  test("PNG: returns correct format", async () => {
    const { width, height, format } = await Bun.file(PNG_FIXTURE).image().metadata();
    expect(width).toBe(10);
    expect(height).toBe(10);
    expect(format).toBe("png");
  });

  test("WebP: returns correct format", async () => {
    const { width, height, format } = await Bun.file(WEBP_FIXTURE).image().metadata();
    expect(width).toBe(10);
    expect(height).toBe(10);
    expect(format).toBe("webp");
  });
});

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------

describe.if(imageSupported)("Bun.Image — resize()", () => {
  async function pngMeta(bytes: Uint8Array) {
    return new Bun.Image(bytes).metadata();
  }

  test("resize(w) single dimension preserves aspect ratio on a square image", async () => {
    const bytes = await Bun.file(PNG_FIXTURE).image().resize(5).png().bytes();
    const { width, height } = await pngMeta(bytes);
    expect(width).toBe(5);
    expect(height).toBe(5);
  });

  test("resize(w, h) stretches to exact dimensions", async () => {
    const bytes = await Bun.file(PNG_FIXTURE).image().resize(20, 5).png().bytes();
    const { width, height } = await pngMeta(bytes);
    expect(width).toBe(20);
    expect(height).toBe(5);
  });

  test("resize with fit: inside fits within the bounding box", async () => {
    // 10×10 input; target box 5×20 with fit:inside → output should be 5×5
    const bytes = await Bun.file(PNG_FIXTURE).image().resize(5, 20, { fit: "inside" }).png().bytes();
    const { width, height } = await pngMeta(bytes);
    expect(width).toBeLessThanOrEqual(5);
    expect(height).toBeLessThanOrEqual(20);
  });

  test("resize with withoutEnlargement: true does not upscale", async () => {
    // 10×10 input; requesting 20×20 should leave it at 10×10
    const bytes = await Bun.file(PNG_FIXTURE).image().resize(20, 20, { withoutEnlargement: true }).png().bytes();
    const { width, height } = await pngMeta(bytes);
    expect(width).toBeLessThanOrEqual(10);
    expect(height).toBeLessThanOrEqual(10);
  });

  test("resize with filter: mitchell is accepted", async () => {
    const bytes = await Bun.file(PNG_FIXTURE).image().resize(5, 5, { filter: "mitchell" }).png().bytes();
    expect(bytes.length).toBeGreaterThan(0);
  });

  test("resize with filter: nearest is accepted", async () => {
    const bytes = await Bun.file(PNG_FIXTURE).image().resize(5, 5, { filter: "nearest" }).png().bytes();
    expect(bytes.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Rotate · flip · flop
// ---------------------------------------------------------------------------

describe.if(imageSupported)("Bun.Image — rotate / flip / flop", () => {
  test("rotate(90) swaps width and height on a non-square image", async () => {
    // First create a 10×5 image
    const nonSquare = await Bun.file(PNG_FIXTURE).image().resize(10, 5).png().bytes();
    const rotated = await new Bun.Image(nonSquare).rotate(90).png().bytes();
    const { width, height } = await new Bun.Image(rotated).metadata();
    expect(width).toBe(5);
    expect(height).toBe(10);
  });

  test("rotate(180) preserves dimensions", async () => {
    const bytes = await Bun.file(PNG_FIXTURE).image().rotate(180).png().bytes();
    const { width, height } = await new Bun.Image(bytes).metadata();
    expect(width).toBe(10);
    expect(height).toBe(10);
  });

  test("rotate(270) swaps width and height on a non-square image", async () => {
    const nonSquare = await Bun.file(PNG_FIXTURE).image().resize(10, 5).png().bytes();
    const rotated = await new Bun.Image(nonSquare).rotate(270).png().bytes();
    const { width, height } = await new Bun.Image(rotated).metadata();
    expect(width).toBe(5);
    expect(height).toBe(10);
  });

  test("flip() produces valid PNG output", async () => {
    const bytes = await Bun.file(PNG_FIXTURE).image().flip().png().bytes();
    expect(bytes[0]).toBe(0x89); // PNG signature
    expect(bytes[1]).toBe(0x50); // 'P'
    const { width, height } = await new Bun.Image(bytes).metadata();
    expect(width).toBe(10);
    expect(height).toBe(10);
  });

  test("flop() produces valid PNG output", async () => {
    const bytes = await Bun.file(PNG_FIXTURE).image().flop().png().bytes();
    expect(bytes[0]).toBe(0x89);
    const { width, height } = await new Bun.Image(bytes).metadata();
    expect(width).toBe(10);
    expect(height).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Modulate
// ---------------------------------------------------------------------------

describe.if(imageSupported)("Bun.Image — modulate()", () => {
  test("modulate({ brightness: 1.2 }) produces valid output", async () => {
    const bytes = await Bun.file(PNG_FIXTURE).image().modulate({ brightness: 1.2 }).png().bytes();
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes[0]).toBe(0x89);
  });

  test("modulate({ saturation: 0 }) produces valid output (greyscale)", async () => {
    const bytes = await Bun.file(PNG_FIXTURE).image().modulate({ saturation: 0 }).png().bytes();
    expect(bytes.length).toBeGreaterThan(0);
  });

  test("modulate({ brightness: 0.8, saturation: 1.5 }) produces valid output", async () => {
    const bytes = await Bun.file(PNG_FIXTURE).image().modulate({ brightness: 0.8, saturation: 1.5 }).png().bytes();
    expect(bytes.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Output formats
// ---------------------------------------------------------------------------

describe.if(imageSupported)("Bun.Image — output formats", () => {
  test("jpeg() output starts with JPEG magic bytes FF D8", async () => {
    const bytes = await Bun.file(PNG_FIXTURE).image().jpeg().bytes();
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xd8);
  });

  test("jpeg({ quality: 85 }) produces valid JPEG", async () => {
    const bytes = await Bun.file(PNG_FIXTURE).image().jpeg({ quality: 85 }).bytes();
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xd8);
  });

  test("jpeg({ progressive: true }) produces valid JPEG", async () => {
    const bytes = await Bun.file(PNG_FIXTURE).image().jpeg({ progressive: true }).bytes();
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xd8);
  });

  test("png() output starts with PNG magic bytes", async () => {
    const bytes = await Bun.file(JPG_FIXTURE).image().png().bytes();
    expect(bytes[0]).toBe(0x89);
    expect(bytes[1]).toBe(0x50); // 'P'
    expect(bytes[2]).toBe(0x4e); // 'N'
    expect(bytes[3]).toBe(0x47); // 'G'
  });

  test("png({ compressionLevel: 6 }) produces valid PNG", async () => {
    const bytes = await Bun.file(JPG_FIXTURE).image().png({ compressionLevel: 6 }).bytes();
    expect(bytes[0]).toBe(0x89);
  });

  test("png({ palette: true, colors: 64, dither: true }) produces valid PNG", async () => {
    const bytes = await Bun.file(JPG_FIXTURE).image().png({ palette: true, colors: 64, dither: true }).bytes();
    expect(bytes[0]).toBe(0x89);
  });

  test("webp() output starts with RIFF....WEBP header", async () => {
    const bytes = await Bun.file(PNG_FIXTURE).image().webp().bytes();
    expect(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])).toBe("RIFF");
    expect(String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11])).toBe("WEBP");
  });

  test("webp({ quality: 80 }) produces valid WebP", async () => {
    const bytes = await Bun.file(PNG_FIXTURE).image().webp({ quality: 80 }).bytes();
    expect(String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11])).toBe("WEBP");
  });

  test("webp({ lossless: true }) produces valid WebP", async () => {
    const bytes = await Bun.file(PNG_FIXTURE).image().webp({ lossless: true }).bytes();
    expect(String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11])).toBe("WEBP");
  });

  test("HEIC/AVIF: either succeeds or throws ERR_IMAGE_FORMAT_UNSUPPORTED", async () => {
    // HEIC is only supported on macOS / Windows; Linux always rejects
    let ok = false;
    try {
      const bytes = await Bun.file(PNG_FIXTURE).image().heic({ quality: 80 }).bytes();
      ok = bytes.length > 0;
    } catch (e: any) {
      ok = e.code === "ERR_IMAGE_FORMAT_UNSUPPORTED";
    }
    expect(ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Terminal methods
// ---------------------------------------------------------------------------

describe.if(imageSupported)("Bun.Image — terminals", () => {
  test("bytes() returns a Uint8Array", async () => {
    const result = await Bun.file(PNG_FIXTURE).image().png().bytes();
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBeGreaterThan(0);
  });

  test("buffer() returns a Buffer", async () => {
    const result = await Bun.file(PNG_FIXTURE).image().png().buffer();
    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBeGreaterThan(0);
  });

  test("blob() returns a Blob with MIME type image/webp", async () => {
    const result = await Bun.file(PNG_FIXTURE).image().webp().blob();
    expect(result).toBeInstanceOf(Blob);
    expect(result.type).toBe("image/webp");
  });

  test("blob() MIME type is image/jpeg for JPEG output", async () => {
    const result = await Bun.file(PNG_FIXTURE).image().jpeg().blob();
    expect(result.type).toBe("image/jpeg");
  });

  test("blob() MIME type is image/png for PNG output", async () => {
    const result = await Bun.file(PNG_FIXTURE).image().png().blob();
    expect(result.type).toBe("image/png");
  });

  test("toBase64() returns a non-empty string", async () => {
    const result = await Bun.file(PNG_FIXTURE).image().png().toBase64();
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  test("toBase64() round-trips: decode back to matching dimensions", async () => {
    const b64 = await Bun.file(PNG_FIXTURE).image().png().toBase64();
    const decoded = Buffer.from(b64, "base64");
    const { width, height } = await new Bun.Image(decoded).metadata();
    expect(width).toBe(10);
    expect(height).toBe(10);
  });

  test("dataurl() returns a string starting with data:image/", async () => {
    const result = await Bun.file(PNG_FIXTURE).image().png().dataurl();
    expect(result).toMatch(/^data:image\//);
  });

  test("dataurl() for WebP starts with data:image/webp;base64,", async () => {
    const result = await Bun.file(PNG_FIXTURE).image().webp().dataurl();
    expect(result).toMatch(/^data:image\/webp;base64,/);
  });

  test("write() returns the number of bytes written and the file exists", async () => {
    const bytesWritten = await Bun.file(PNG_FIXTURE).image().png().write(TMP_OUTPUT);
    expect(typeof bytesWritten).toBe("number");
    expect(bytesWritten).toBeGreaterThan(0);
    expect(existsSync(TMP_OUTPUT)).toBe(true);
  });

  test("width and height are -1 before a terminal resolves", () => {
    const img = Bun.file(PNG_FIXTURE).image().resize(5, 5);
    expect(img.width).toBe(-1);
    expect(img.height).toBe(-1);
  });

  test("width and height reflect output dimensions after a terminal resolves", async () => {
    const img = Bun.file(PNG_FIXTURE).image().resize(5, 5);
    await img.png().bytes();
    expect(img.width).toBe(5);
    expect(img.height).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Placeholders
// ---------------------------------------------------------------------------

describe.if(imageSupported)("Bun.Image — placeholder()", () => {
  test("returns a data: URL string", async () => {
    const result = await Bun.file(JPG_FIXTURE).image().placeholder();
    expect(typeof result).toBe("string");
    expect(result).toMatch(/^data:/);
  });

  test("placeholder is short (suitable for inlining, < 2000 chars)", async () => {
    const result = await Bun.file(JPG_FIXTURE).image().placeholder();
    expect(result.length).toBeLessThan(2000);
  });

  test("placeholder works on PNG input too", async () => {
    const result = await Bun.file(PNG_FIXTURE).image().placeholder();
    expect(result).toMatch(/^data:/);
  });
});

// ---------------------------------------------------------------------------
// Backend
// ---------------------------------------------------------------------------

describe.if(imageSupported)("Bun.Image — backend", () => {
  test("Bun.Image.backend is a readable string", () => {
    expect(typeof Bun.Image.backend).toBe("string");
  });

  test('setting backend to "bun" does not throw', () => {
    const original = Bun.Image.backend;
    expect(() => {
      Bun.Image.backend = "bun";
    }).not.toThrow();
    Bun.Image.backend = original;
  });

  test('with "bun" backend, JPEG output is valid (portable cross-platform path)', async () => {
    const original = Bun.Image.backend;
    Bun.Image.backend = "bun";
    try {
      const bytes = await Bun.file(PNG_FIXTURE).image().jpeg().bytes();
      expect(bytes[0]).toBe(0xff);
      expect(bytes[1]).toBe(0xd8);
    } finally {
      Bun.Image.backend = original;
    }
  });

  test('with "bun" backend, PNG output is valid', async () => {
    const original = Bun.Image.backend;
    Bun.Image.backend = "bun";
    try {
      const bytes = await Bun.file(JPG_FIXTURE).image().png().bytes();
      expect(bytes[0]).toBe(0x89);
    } finally {
      Bun.Image.backend = original;
    }
  });

  test('with "bun" backend, WebP output is valid', async () => {
    const original = Bun.Image.backend;
    Bun.Image.backend = "bun";
    try {
      const bytes = await Bun.file(PNG_FIXTURE).image().webp().bytes();
      expect(String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11])).toBe("WEBP");
    } finally {
      Bun.Image.backend = original;
    }
  });
});
