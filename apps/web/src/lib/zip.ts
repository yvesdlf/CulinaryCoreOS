// ---------------------------------------------------------------------------
// Minimal ZIP writer
// ---------------------------------------------------------------------------
// Exporting a collection means one file per recipe landing in a folder someone
// can file, email or print — which needs an archive, because a browser will
// not write a directory.
//
// Written rather than depended on. The requirement is one method (STORE, no
// compression) over text files whose total size is measured in kilobytes, and
// the format is forty years old and fully specified. A compression library
// would be an order of magnitude more code than the thing it replaces, and
// HTML zips poorly enough that the saving would not repay it.
//
// Deliberately not implemented: ZIP64, encryption, and directory entries.
// Paths carry their folders in the name, which every extractor understands.
// ---------------------------------------------------------------------------

export interface ZipEntry {
  /** Path inside the archive, e.g. "sunset-menu/grilled-octopus.html". */
  name: string;
  content: string;
}

/** CRC-32, the checksum the format requires. Table built once, lazily. */
let crcTable: Uint32Array | null = null;

function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      crcTable[i] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of bytes) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff];
}

function u32(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}

/**
 * Build a ZIP archive from text entries.
 *
 * Local headers, then the central directory, then the end record — the order
 * the format specifies, because extractors read the end record first to find
 * the directory and a file written any other way will not open.
 */
export function createZip(entries: ZipEntry[]): Blob {
  const encoder = new TextEncoder();
  const parts: BlobPart[] = [];
  const central: number[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const data = encoder.encode(entry.content);
    const crc = crc32(data);

    // Bit 11 marks the name as UTF-8, which is what stops an accented dish
    // name arriving mojibaked on a machine with a different code page.
    const flags = 0x0800;

    const local = [
      ...u32(0x04034b50), // local file header signature
      ...u16(20), // version needed
      ...u16(flags),
      ...u16(0), // method: stored
      ...u16(0), // modification time
      ...u16(0), // modification date
      ...u32(crc),
      ...u32(data.length), // compressed size == uncompressed, stored
      ...u32(data.length),
      ...u16(nameBytes.length),
      ...u16(0), // extra field length
    ];

    parts.push(new Uint8Array(local), nameBytes, data);

    central.push(
      ...u32(0x02014b50), // central directory header signature
      ...u16(20), // version made by
      ...u16(20), // version needed
      ...u16(flags),
      ...u16(0), // method
      ...u16(0),
      ...u16(0),
      ...u32(crc),
      ...u32(data.length),
      ...u32(data.length),
      ...u16(nameBytes.length),
      ...u16(0), // extra
      ...u16(0), // comment
      ...u16(0), // disk number
      ...u16(0), // internal attributes
      ...u32(0), // external attributes
      ...u32(offset), // where the local header sits
      ...Array.from(nameBytes),
    );

    offset += local.length + nameBytes.length + data.length;
  }

  const centralBytes = new Uint8Array(central);
  parts.push(centralBytes);
  parts.push(
    new Uint8Array([
      ...u32(0x06054b50), // end of central directory
      ...u16(0), // this disk
      ...u16(0), // disk with the directory
      ...u16(entries.length),
      ...u16(entries.length),
      ...u32(centralBytes.length),
      ...u32(offset),
      ...u16(0), // comment length
    ]),
  );

  return new Blob(parts, { type: "application/zip" });
}

/**
 * A name safe inside an archive and on the filesystem it lands on.
 *
 * "Bisque de Marisco (serves 2)" is a fine dish name and a poor filename on
 * Windows, where a colon or a slash makes the file unopenable rather than
 * oddly named.
 */
export function safeFilename(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "") // strip accents rather than drop the letter
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
      .slice(0, 80) || "untitled"
  );
}

export function downloadZip(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".zip") ? filename : `${filename}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
