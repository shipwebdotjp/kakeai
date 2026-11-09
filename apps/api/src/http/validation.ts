import type { Request } from "express";
import type { z, ZodError } from "zod";
import { ApiError } from "./errors.ts";

export interface ValidationIssue {
  path: (string | number)[];
  code: string;
  message: string;
}

export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw validationErrorFromZod(result.error);
  }
  return result.data;
}

export function validationError(issues: ValidationIssue[]): ApiError {
  return new ApiError(422, "VALIDATION_ERROR", undefined, { issues });
}

export function validationErrorFromZod(error: ZodError): ApiError {
  return validationError(
    error.issues.map((issue) => ({
      path: issue.path.map((segment) =>
        typeof segment === "symbol" ? segment.toString() : segment,
      ),
      code: issue.code,
      message: issue.message,
    })),
  );
}

export function resourceNotFound(resource: string, id: string): ApiError {
  return new ApiError(404, "RESOURCE_NOT_FOUND", undefined, { resource, id });
}

export function pathParam(req: Request, name: string): string {
  const value = req.params[name];
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
}

function integerQuery(req: Request, name: string): number | undefined {
  const raw = req.query[name];
  if (raw === undefined) {
    return undefined;
  }
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw validationError([
      {
        path: [name],
        code: "custom",
        message: `${name} には0以上の整数を指定してください。`,
      },
    ]);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw validationError([
      {
        path: [name],
        code: "custom",
        message: `${name} には0以上の整数を指定してください。`,
      },
    ]);
  }
  return parsed;
}

const LIST_LIMIT_MAX = 500;
const LIST_OFFSET_MAX = 10_000;

/** Shared bounded window for list endpoints. Defaults to the newest 200 rows. */
export function listWindow(req: Request): { limit: number; offset: number } {
  const limit = integerQuery(req, "limit") ?? 200;
  const offset = integerQuery(req, "offset") ?? 0;
  if (limit < 1 || limit > LIST_LIMIT_MAX) {
    throw validationError([
      {
        path: ["limit"],
        code: "custom",
        message: `limit は1〜${LIST_LIMIT_MAX}で指定してください。`,
      },
    ]);
  }
  if (offset < 0 || offset > LIST_OFFSET_MAX) {
    throw validationError([
      {
        path: ["offset"],
        code: "custom",
        message: `offset は0〜${LIST_OFFSET_MAX}で指定してください。`,
      },
    ]);
  }
  return { limit, offset };
}
