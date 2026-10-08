import type { Request } from "express";
import type { z } from "zod";
import { ApiError } from "./errors.ts";

export interface ValidationIssue {
  path: (string | number)[];
  code: string;
  message: string;
}

export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw validationError(
      result.error.issues.map((issue) => ({
        path: issue.path.map((segment) =>
          typeof segment === "symbol" ? segment.toString() : segment,
        ),
        code: issue.code,
        message: issue.message,
      })),
    );
  }
  return result.data;
}

export function validationError(issues: ValidationIssue[]): ApiError {
  return new ApiError(422, "VALIDATION_ERROR", undefined, { issues });
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
