import { describe, expect, it } from "vitest";
import { parseJpegOrientation } from "./exif.ts";

function jpegWithOrientation(orientation: number): Uint8Array {
  const tiff = Buffer.alloc(26);
  tiff.write("II", 0, "latin1");
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x0112, 10);
  tiff.writeUInt16LE(3, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt16LE(orientation, 18);
  tiff.writeUInt32LE(0, 22);
  const exif = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const app1 = Buffer.alloc(4);
  app1.writeUInt16BE(0xffe1, 0);
  app1.writeUInt16BE(exif.length + 2, 2);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, exif, Buffer.from([0xff, 0xd9])]);
}

describe("parseJpegOrientation", () => {
  it("reads the EXIF orientation tag", () => {
    expect(parseJpegOrientation(jpegWithOrientation(6))).toBe(6);
    expect(parseJpegOrientation(jpegWithOrientation(8))).toBe(8);
    expect(parseJpegOrientation(jpegWithOrientation(1))).toBe(1);
  });

  it("falls back to 1 for non-JPEG or out-of-range values", () => {
    expect(parseJpegOrientation(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(1);
    expect(parseJpegOrientation(jpegWithOrientation(0))).toBe(1);
  });
});
