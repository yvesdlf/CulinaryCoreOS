import { describe, it, expect } from "vitest";
import { createZip, safeFilename } from "./zip";

/**
 * ZIP writing.
 *
 * A malformed archive fails at the point someone tries to open it, long after
 * the export reported success, so these check the bytes the format actually
 * requires rather than that the function returned something.
 */
async function bytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

const u32at = (b: Uint8Array, i: number) =>
  (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
const u16at = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);

describe("createZip", () => {
  it("starts with a local file header", async () => {
    const b = await bytes(createZip([{ name: "a.txt", content: "hello" }]));
    expect(u32at(b, 0)).toBe(0x04034b50);
  });

  it("ends with the end-of-central-directory record", async () => {
    // Extractors read this first to find the directory; without it the file
    // is not an archive at all.
    const b = await bytes(createZip([{ name: "a.txt", content: "hello" }]));
    const eocdAt = b.length - 22;
    expect(u32at(b, eocdAt)).toBe(0x06054b50);
    expect(u16at(b, eocdAt + 8)).toBe(1); // entries on this disk
  });

  it("records the entry count", async () => {
    const b = await bytes(
      createZip([
        { name: "a.txt", content: "1" },
        { name: "b.txt", content: "2" },
        { name: "c.txt", content: "3" },
      ]),
    );
    expect(u16at(b, b.length - 22 + 10)).toBe(3);
  });

  it("stores the content verbatim, so it can be read back", async () => {
    const b = await bytes(createZip([{ name: "a.txt", content: "hello" }]));
    expect(new TextDecoder().decode(b.slice(-22 - 5 - 5 - 46, undefined))).toContain("a.txt");
    expect(new TextDecoder().decode(b)).toContain("hello");
  });

  it("marks names as UTF-8, so an accent survives the round trip", async () => {
    const b = await bytes(createZip([{ name: "crudités.html", content: "x" }]));
    // General purpose bit 11.
    expect(u16at(b, 6) & 0x0800).toBe(0x0800);
    expect(new TextDecoder().decode(b)).toContain("crudités");
  });

  it("produces a valid empty archive", async () => {
    const b = await bytes(createZip([]));
    expect(b.length).toBe(22);
    expect(u32at(b, 0)).toBe(0x06054b50);
  });

  it("computes a real CRC rather than leaving it zero", async () => {
    const b = await bytes(createZip([{ name: "a.txt", content: "hello" }]));
    // Known CRC-32 of "hello".
    expect(u32at(b, 14)).toBe(0x3610a686);
  });
});

describe("safeFilename", () => {
  it("makes a dish name usable as a filename", () => {
    // Parentheses and spaces are fine in a dish name and poor in a path.
    expect(safeFilename("Bisque de Marisco (serves 2)")).toBe(
      "bisque-de-marisco-serves-2",
    );
  });

  it("strips accents rather than dropping the letter", () => {
    expect(safeFilename("Crudités")).toBe("crudites");
  });

  it("never returns an empty name", () => {
    expect(safeFilename("!!!")).toBe("untitled");
    expect(safeFilename("")).toBe("untitled");
  });

  it("caps the length, since some filesystems will not take a long one", () => {
    expect(safeFilename("a".repeat(200)).length).toBeLessThanOrEqual(80);
  });
});
