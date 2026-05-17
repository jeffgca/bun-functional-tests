import { describe, test, expect } from "bun:test";
import { password, CryptoHasher } from "bun";

// ---------------------------------------------------------------------------
// Bun.hash — fast non-cryptographic hashes
// ---------------------------------------------------------------------------

describe("Bun.hash — non-cryptographic hashes", () => {
  test("Bun.hash(string) returns a number or bigint", () => {
    const h = Bun.hash("hello");
    expect(typeof h === "number" || typeof h === "bigint").toBe(true);
  });

  test("same input always produces same hash", () => {
    expect(Bun.hash("test")).toBe(Bun.hash("test"));
  });

  test("different inputs produce different hashes", () => {
    expect(Bun.hash("foo")).not.toBe(Bun.hash("bar"));
  });

  test("Bun.hash accepts Uint8Array", () => {
    const bytes = new TextEncoder().encode("hello");
    const h = Bun.hash(bytes);
    expect(typeof h === "number" || typeof h === "bigint").toBe(true);
  });

  test("Bun.hash accepts ArrayBuffer", () => {
    const buf = new TextEncoder().encode("hello").buffer;
    const h = Bun.hash(buf);
    expect(typeof h === "number" || typeof h === "bigint").toBe(true);
  });

  test("hash.wyhash returns bigint", () => {
    const h = Bun.hash.wyhash("hello");
    expect(typeof h).toBe("bigint");
  });

  test("hash.wyhash is deterministic", () => {
    expect(Bun.hash.wyhash("bun")).toBe(Bun.hash.wyhash("bun"));
  });

  test("hash.adler32 returns a number", () => {
    expect(typeof Bun.hash.adler32("hello")).toBe("number");
  });

  test("hash.crc32 returns a number", () => {
    expect(typeof Bun.hash.crc32("hello")).toBe("number");
  });

  test("hash.crc32 is deterministic", () => {
    expect(Bun.hash.crc32("abc")).toBe(Bun.hash.crc32("abc"));
  });

  test("hash.cityHash32 returns a number", () => {
    expect(typeof Bun.hash.cityHash32("hello")).toBe("number");
  });

  test("hash.cityHash64 returns bigint", () => {
    expect(typeof Bun.hash.cityHash64("hello")).toBe("bigint");
  });

  test("hash.xxHash32 returns a number", () => {
    expect(typeof Bun.hash.xxHash32("hello")).toBe("number");
  });

  test("hash.xxHash64 returns bigint", () => {
    expect(typeof Bun.hash.xxHash64("hello")).toBe("bigint");
  });

  test("hash.xxHash3 returns bigint", () => {
    expect(typeof Bun.hash.xxHash3("hello")).toBe("bigint");
  });

  test("hash.murmur32v3 returns a number", () => {
    expect(typeof Bun.hash.murmur32v3("hello")).toBe("number");
  });

  test("hash.rapidhash returns bigint", () => {
    expect(typeof Bun.hash.rapidhash("hello")).toBe("bigint");
  });

  test("seed changes the wyhash output", () => {
    const a = Bun.hash.wyhash("data", 0n);
    const b = Bun.hash.wyhash("data", 1n);
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// Bun.CryptoHasher — cryptographic hashes
// ---------------------------------------------------------------------------

describe("Bun.CryptoHasher — SHA / Blake / etc.", () => {
  test("sha256 hex digest has 64 hex chars", () => {
    const h = new CryptoHasher("sha256");
    const hex = h.update("hello world").digest("hex");
    expect(hex).toHaveLength(64);
    expect(hex).toMatch(/^[0-9a-f]+$/);
  });

  test("sha256 is deterministic", () => {
    const a = new CryptoHasher("sha256").update("bun").digest("hex");
    const b = new CryptoHasher("sha256").update("bun").digest("hex");
    expect(a).toBe(b);
  });

  test("sha256 known vector", () => {
    // echo -n '' | shasum -a 256
    const empty = new CryptoHasher("sha256").update("").digest("hex");
    expect(empty).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  test("sha1 hex digest has 40 chars", () => {
    const hex = new CryptoHasher("sha1").update("hello").digest("hex");
    expect(hex).toHaveLength(40);
  });

  test("sha512 hex digest has 128 chars", () => {
    const hex = new CryptoHasher("sha512").update("hello").digest("hex");
    expect(hex).toHaveLength(128);
  });

  test("md5 hex digest has 32 chars", () => {
    const hex = new CryptoHasher("md5").update("hello").digest("hex");
    expect(hex).toHaveLength(32);
  });

  test("blake2b256 hex digest has 64 chars", () => {
    const hex = new CryptoHasher("blake2b256").update("hello").digest("hex");
    expect(hex).toHaveLength(64);
  });

  test("digest() without encoding returns Buffer", () => {
    const result = new CryptoHasher("sha256").update("test").digest();
    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBe(32);
  });

  test("digest('base64') returns a non-empty base64 string", () => {
    const b64 = new CryptoHasher("sha256").update("bun").digest("base64");
    expect(typeof b64).toBe("string");
    expect(b64.length).toBeGreaterThan(0);
  });

  test("chained .update() calls accumulate data", () => {
    const combined = new CryptoHasher("sha256").update("hel").update("lo").digest("hex");
    const direct = new CryptoHasher("sha256").update("hello").digest("hex");
    expect(combined).toBe(direct);
  });

  test(".copy() produces an independent hasher", () => {
    const h1 = new CryptoHasher("sha256").update("hello");
    const h2 = h1.copy();
    h2.update(" world");
    const d1 = h1.digest("hex");
    const d2 = h2.digest("hex");
    expect(d1).not.toBe(d2);
  });

  test("CryptoHasher.hash() static helper returns Buffer", () => {
    const buf = CryptoHasher.hash("sha256", "hello");
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBe(32);
  });

  test("HMAC mode with sha256 produces different output than plain sha256", () => {
    const plain = new CryptoHasher("sha256").update("msg").digest("hex");
    const hmac = new CryptoHasher("sha256", "secret-key").update("msg").digest("hex");
    expect(plain).not.toBe(hmac);
  });

  test("HMAC is deterministic with same key", () => {
    const a = new CryptoHasher("sha256", "key").update("data").digest("hex");
    const b = new CryptoHasher("sha256", "key").update("data").digest("hex");
    expect(a).toBe(b);
  });

  test(".algorithm property reflects the chosen algorithm", () => {
    const h = new CryptoHasher("sha384");
    expect(h.algorithm).toBe("sha384");
  });

  test(".byteLength reflects output size", () => {
    expect(new CryptoHasher("sha256").byteLength).toBe(32);
    expect(new CryptoHasher("sha512").byteLength).toBe(64);
    expect(new CryptoHasher("md5").byteLength).toBe(16);
  });
});

// ---------------------------------------------------------------------------
// Bun.password — argon2 / bcrypt
// ---------------------------------------------------------------------------

describe("Bun.password — argon2", () => {
  test("hash returns a string starting with $argon2", async () => {
    const h = await password.hash("secret");
    expect(h).toMatch(/^\$argon2/);
  });

  test("verify returns true for correct password", async () => {
    const h = await password.hash("correct-horse");
    expect(await password.verify("correct-horse", h)).toBe(true);
  });

  test("verify returns false for wrong password", async () => {
    const h = await password.hash("correct-horse");
    expect(await password.verify("wrong-horse", h)).toBe(false);
  });

  test("two hashes of the same password differ (salted)", async () => {
    const a = await password.hash("same");
    const b = await password.hash("same");
    expect(a).not.toBe(b);
  });

  test("hashSync + verifySync work synchronously", () => {
    const h = password.hashSync("sync-password");
    expect(password.verifySync("sync-password", h)).toBe(true);
    expect(password.verifySync("wrong", h)).toBe(false);
  });
});

describe("Bun.password — bcrypt", () => {
  test("bcrypt hash starts with $2", async () => {
    const h = await password.hash("pw", "bcrypt");
    expect(h).toMatch(/^\$2/);
  });

  test("bcrypt verify returns true for correct password", async () => {
    const h = await password.hash("bcrypt-pw", "bcrypt");
    expect(await password.verify("bcrypt-pw", h, "bcrypt")).toBe(true);
  });

  test("bcrypt verify returns false for wrong password", async () => {
    const h = await password.hash("bcrypt-pw", "bcrypt");
    expect(await password.verify("nope", h, "bcrypt")).toBe(false);
  });
});
