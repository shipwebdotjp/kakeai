import { createReadStream } from "node:fs";
import type { NextFunction, Request, Response } from "express";

export interface ByteRange {
  start: number;
  end: number;
}

export interface ContentFile {
  path: string;
  mediaType: string;
  byteSize: number;
}

export function parseRange(header: string | undefined, size: number): ByteRange | "invalid" | null {
  if (header === undefined || header.trim().length === 0) {
    return null;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (match === null) {
    return null;
  }
  const startText = match[1] ?? "";
  const endText = match[2] ?? "";
  if (startText === "" && endText === "") {
    return "invalid";
  }
  if (size <= 0) {
    return "invalid";
  }
  if (startText === "") {
    const suffixLength = Number(endText);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
      return "invalid";
    }
    const start = Math.max(0, size - suffixLength);
    return { start, end: size - 1 };
  }
  const start = Number(startText);
  if (!Number.isInteger(start) || start >= size) {
    return "invalid";
  }
  const end = endText === "" ? size - 1 : Math.min(Number(endText), size - 1);
  if (!Number.isInteger(end) || end < start) {
    return "invalid";
  }
  return { start, end };
}

export function sendContent(
  req: Request,
  res: Response,
  next: NextFunction,
  file: ContentFile,
): void {
  res.setHeader("Content-Type", file.mediaType);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
  res.setHeader("X-Content-Type-Options", "nosniff");

  const range = parseRange(req.headers.range, file.byteSize);
  if (range === "invalid") {
    res.setHeader("Content-Range", `bytes */${file.byteSize}`);
    res.status(416).end();
    return;
  }

  const onError = (error: unknown): void => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    next(error);
  };

  if (range === null) {
    res.setHeader("Content-Length", String(file.byteSize));
    res.status(200);
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(file.path).on("error", onError).pipe(res);
    return;
  }

  res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${file.byteSize}`);
  res.setHeader("Content-Length", String(range.end - range.start + 1));
  res.status(206);
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(file.path, { start: range.start, end: range.end }).on("error", onError).pipe(res);
}
