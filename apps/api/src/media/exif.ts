import { open } from "node:fs/promises";

const EXIF_HEADER_READ_BYTES = 1024 * 1024;
const EXIF_MARKER = 0xe1;
const SOS_MARKER = 0xda;
const EOI_MARKER = 0xd9;

function readUint16(bytes: Uint8Array, offset: number, littleEndian: boolean): number {
  return littleEndian
    ? bytes[offset]! | (bytes[offset + 1]! << 8)
    : (bytes[offset]! << 8) | bytes[offset + 1]!;
}

function readUint32(bytes: Uint8Array, offset: number, littleEndian: boolean): number {
  return littleEndian
    ? (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0
    : ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0;
}

function readTiffOrientation(tiff: Uint8Array): number {
  if (tiff.length < 8) {
    return 1;
  }
  const byteOrder = String.fromCharCode(tiff[0]!, tiff[1]!);
  const littleEndian = byteOrder === "II";
  if (!littleEndian && byteOrder !== "MM") {
    return 1;
  }
  if (readUint16(tiff, 2, littleEndian) !== 42) {
    return 1;
  }
  const ifdOffset = readUint32(tiff, 4, littleEndian);
  if (ifdOffset + 2 > tiff.length) {
    return 1;
  }
  const entryCount = readUint16(tiff, ifdOffset, littleEndian);
  let cursor = ifdOffset + 2;
  for (let i = 0; i < entryCount; i += 1) {
    if (cursor + 12 > tiff.length) {
      return 1;
    }
    const tag = readUint16(tiff, cursor, littleEndian);
    if (tag === 0x0112) {
      const type = readUint16(tiff, cursor + 2, littleEndian);
      const count = readUint32(tiff, cursor + 4, littleEndian);
      if ((type === 3 || type === 4) && count === 1) {
        const value =
          type === 3
            ? readUint16(tiff, cursor + 8, littleEndian)
            : readUint32(tiff, cursor + 8, littleEndian);
        return value >= 1 && value <= 8 ? value : 1;
      }
      return 1;
    }
    cursor += 12;
  }
  return 1;
}

export function parseJpegOrientation(bytes: Uint8Array): number {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return 1;
  }
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1]!;
    if (marker === SOS_MARKER || marker === EOI_MARKER) {
      return 1;
    }
    if (marker >= 0xd0 && marker <= 0xd7) {
      offset += 2;
      continue;
    }
    const segmentLength = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    if (segmentLength < 2) {
      return 1;
    }
    if (marker === EXIF_MARKER) {
      const start = offset + 4;
      const end = offset + 2 + segmentLength;
      if (end <= bytes.length) {
        const segment = bytes.subarray(start, end);
        if (
          segment.length >= 6 &&
          segment[0] === 0x45 &&
          segment[1] === 0x78 &&
          segment[2] === 0x69 &&
          segment[3] === 0x66
        ) {
          return readTiffOrientation(segment.subarray(6));
        }
      }
    }
    offset += 2 + segmentLength;
  }
  return 1;
}

export async function readJpegOrientation(filePath: string): Promise<number> {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(EXIF_HEADER_READ_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, EXIF_HEADER_READ_BYTES, 0);
    return parseJpegOrientation(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}
