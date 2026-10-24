import { ApiError } from "../http/errors.ts";

/** PNG chunk layout after the 8-byte signature. */
const PNG_SIGNATURE_HEX = "89504e470d0a1a0a";
const PNG_IHDR_LENGTH_OFFSET = 8;
const PNG_IHDR_TYPE_OFFSET = 12;
const PNG_WIDTH_OFFSET = 16;
const PNG_HEIGHT_OFFSET = 20;
const PNG_IHDR_MIN_LENGTH = 24;
const INVALID_PNG_MESSAGE = "静止画の形式が不正です。";

/** Reads the dimensions from a PNG IHDR chunk. */
export function parsePngDimensions(png: Buffer): { width: number; height: number } {
  if (
    png.length < PNG_IHDR_MIN_LENGTH ||
    png.subarray(0, 8).toString("hex") !== PNG_SIGNATURE_HEX ||
    png.readUInt32BE(PNG_IHDR_LENGTH_OFFSET) !== 13 ||
    png.toString("ascii", PNG_IHDR_TYPE_OFFSET, PNG_IHDR_TYPE_OFFSET + 4) !== "IHDR"
  ) {
    throw new ApiError(500, "INTERNAL_ERROR", INVALID_PNG_MESSAGE);
  }
  const width = png.readUInt32BE(PNG_WIDTH_OFFSET);
  const height = png.readUInt32BE(PNG_HEIGHT_OFFSET);
  if (width <= 0 || height <= 0) {
    throw new ApiError(500, "INTERNAL_ERROR", INVALID_PNG_MESSAGE);
  }
  return { width, height };
}
