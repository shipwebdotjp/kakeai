import { describe, expect, it } from "vitest";
import { readImageDimensions } from "./image-dimensions.ts";

function png(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  buffer[24] = 8;
  buffer[25] = 6;
  return buffer;
}

function jpeg(width: number, height: number): Buffer {
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xd9,
  ]);
}

function webpVp8x(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(30);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(22, 4);
  buffer.write("WEBP", 8, "ascii");
  buffer.write("VP8X", 12, "ascii");
  buffer.writeUInt32LE(10, 16);
  buffer.writeUIntLE(width - 1, 24, 3);
  buffer.writeUIntLE(height - 1, 27, 3);
  return buffer;
}

describe("readImageDimensions", () => {
  it("reads PNG, JPEG and WebP dimensions from bytes", () => {
    expect(readImageDimensions(png(32, 18), "image/png")).toEqual({
      width: 32,
      height: 18,
    });
    expect(readImageDimensions(jpeg(640, 360), "image/jpeg")).toEqual({
      width: 640,
      height: 360,
    });
    expect(readImageDimensions(webpVp8x(1920, 1080), "image/webp")).toEqual({
      width: 1920,
      height: 1080,
    });
  });

  it("returns null for malformed bytes", () => {
    expect(readImageDimensions(Buffer.alloc(0), "image/png")).toBeNull();
    expect(readImageDimensions(Buffer.from("not-a-jpeg"), "image/jpeg")).toBeNull();
    expect(readImageDimensions(Buffer.from("not-a-webp"), "image/webp")).toBeNull();
  });
});
