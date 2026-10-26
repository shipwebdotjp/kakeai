import { readdir, readFile, stat } from "node:fs/promises";
import { join, isAbsolute, relative, resolve, sep } from "node:path";
import { OUTPUT_FPS, escapeHtmlAttribute, toSecondsText } from "@kakeai/video";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import {
  type CompositionDraft,
  type CompositionVersion,
  type CompositionManifest,
  type CompositionAuthoredStyleProvenance,
  type CompositionStyleProvenance,
  compositionManifestSchema,
  compositionStyleProvenanceSchema,
} from "@kakeai/contracts";
import { ApiError } from "../../http/errors.ts";
import {
  styleKitModifiedError,
  verifyCompositionStyleKit,
} from "../style-kit.ts";

export interface CompositionServiceDependencies {
  db: PrismaClient;
  dataDir: string;
}

export interface ValidateBundleResult {
  manifest: CompositionManifest;
  contentHash: string;
}

export interface CompositionIssue {
  path: (string | number)[];
  code: string;
  message: string;
}

export const MAX_LINT_ISSUES = 20;
export const MAX_DRAFT_FILES = 256;
export const MAX_DRAFT_FILE_BYTES = 4_000_000;
export const MAX_DRAFT_TOTAL_BYTES = 16_000_000;
export const MAX_DEPENDENCY_SCAN_BYTES = 2_000_000;

export function compositionValidationError(
  issues: CompositionIssue[],
): ApiError {
  return new ApiError(422, "VALIDATION_ERROR", undefined, { issues });
}

export function draftLimitError(message: string): ApiError {
  return compositionValidationError([
    { path: ["files"], code: "draft_too_large", message },
  ]);
}

export function draftNotFound(compositionId: string): ApiError {
  return new ApiError(404, "RESOURCE_NOT_FOUND", undefined, {
    resource: "composition_draft",
    id: compositionId,
  });
}

export function parseCompositionStyleProvenance(
  json: string | null | undefined,
): CompositionStyleProvenance {
  if (json === null || json === undefined) {
    return { kind: "legacy" };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new ApiError(
      500,
      "INTERNAL_ERROR",
      "CompositionのStyle Provenanceを解釈できません。",
    );
  }
  const parsed = compositionStyleProvenanceSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(
      500,
      "INTERNAL_ERROR",
      "CompositionのStyle Provenanceを解釈できません。",
    );
  }
  return parsed.data;
}

export function authoredProvenanceOf(
  provenance: CompositionStyleProvenance | undefined,
): CompositionAuthoredStyleProvenance | undefined {
  return provenance?.kind === "authored" ? provenance : undefined;
}

export interface CompositionDraftRow {
  id: string;
  compositionId: string;
  entrypoint: string;
  storageKey: string;
  authoringStyleJson: string | null;
  updatedAt: Date;
}

export interface CompositionVersionRow {
  id: string;
  compositionId: string;
  versionNumber: number;
  bundleHash: string;
  storageKey: string;
  manifestJson: string;
  styleProvenanceJson: string | null;
  createdAt: Date;
}

export function toCompositionDraftDto(
  draft: CompositionDraftRow,
): CompositionDraft {
  return {
    id: draft.id,
    compositionId: draft.compositionId,
    entrypoint: draft.entrypoint,
    storageKey: draft.storageKey,
    updatedAt: draft.updatedAt.toISOString(),
    styleProvenance: parseCompositionStyleProvenance(draft.authoringStyleJson),
  };
}

export function parseCompositionManifest(json: string): CompositionManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new ApiError(
      500,
      "INTERNAL_ERROR",
      "Composition manifestを解釈できません。",
    );
  }
  const parsed = compositionManifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(
      500,
      "INTERNAL_ERROR",
      "Composition manifestを解釈できません。",
    );
  }
  return parsed.data;
}

export function toCompositionVersionDto(
  version: CompositionVersionRow,
): CompositionVersion {
  return {
    id: version.id,
    compositionId: version.compositionId,
    versionNumber: version.versionNumber,
    bundleHash: version.bundleHash,
    storageKey: version.storageKey,
    manifest: parseCompositionManifest(version.manifestJson),
    styleProvenance: parseCompositionStyleProvenance(
      version.styleProvenanceJson,
    ),
    createdAt: version.createdAt.toISOString(),
  };
}

export async function assertStyleKitIntact(
  draftDir: string,
  provenance: CompositionStyleProvenance | undefined,
): Promise<void> {
  const authored = authoredProvenanceOf(provenance);
  if (authored === undefined) {
    return;
  }
  const issues = await verifyCompositionStyleKit(draftDir, authored);
  if (issues.length > 0) {
    throw styleKitModifiedError(issues);
  }
}

export function invalidPathError(relPath: string, label: string): ApiError {
  return compositionValidationError([
    {
      path: ["files", relPath],
      code: "invalid_path",
      message: `${label} '${relPath}' はバンドル内の相対パスにしてください`,
    },
  ]);
}

export function parseManifestIssues(manifestContent: string): {
  manifest?: CompositionManifest;
  issues: CompositionIssue[];
} {
  let raw: unknown;
  try {
    raw = JSON.parse(manifestContent);
  } catch (err) {
    return {
      issues: [
        {
          path: ["manifest"],
          code: "invalid_json",
          message: `manifest.json をJSONとして解釈できません: ${(err as Error).message}`,
        },
      ],
    };
  }
  const parsed = compositionManifestSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      issues: parsed.error.issues.map((issue) => ({
        path: [
          "manifest",
          ...issue.path.map((segment) =>
            typeof segment === "symbol" ? segment.toString() : segment,
          ),
        ],
        code: issue.code,
        message: issue.message,
      })),
    };
  }
  return { manifest: parsed.data, issues: [] };
}

export const EXTERNAL_URL_PATTERN =
  /(?:src|href|poster)\s*=\s*["']?\s*(?:\/\/|https?:\/\/)|url\(\s*["']?\s*(?:\/\/|https?:\/\/)|@import\s+(?:url\()?\s*["']?\s*(?:\/\/|https?:\/\/)|(?:fetch|import|XMLHttpRequest\.open|WebSocket)\s*\(\s*["']\s*(?:\/\/|https?:\/\/|wss?:\/\/)/i;

export function findExternalUrl(content: string): string | undefined {
  const match = content.match(EXTERNAL_URL_PATTERN);
  return match?.[0];
}

export function findCompositionId(html: string): string | undefined {
  const match = html.match(
    /<[^>]*\bdata-composition-id\s*=\s*["']([^"']*)["']/i,
  );
  return match?.[1];
}

export function findEntryDimensions(
  html: string,
): { width?: string; height?: string } | undefined {
  const width = html.match(/\bdata-width\s*=\s*["']([^"']*)["']/i)?.[1];
  const height = html.match(/\bdata-height\s*=\s*["']([^"']*)["']/i)?.[1];
  if (width === undefined && height === undefined) {
    return undefined;
  }
  return { width, height };
}

export interface DraftBudget {
  files: number;
  bytes: number;
}

export async function collectDraftFiles(
  dir: string,
  base: string = dir,
  budget: DraftBudget = { files: 0, bytes: 0 },
  collected: {
    files: Record<string, string>;
    binaryFiles: Record<string, string>;
  } = {
    files: {},
    binaryFiles: {},
  },
): Promise<{
  files: Record<string, string>;
  binaryFiles: Record<string, string>;
}> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectDraftFiles(full, base, budget, collected);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const key = relative(base, full).split(sep).join("/");
    const info = await stat(full);
    if (info.size > MAX_DRAFT_FILE_BYTES) {
      throw draftLimitError(`ファイル '${key}' が大きすぎます`);
    }
    budget.files += 1;
    budget.bytes += info.size;
    if (
      budget.files > MAX_DRAFT_FILES ||
      budget.bytes > MAX_DRAFT_TOTAL_BYTES
    ) {
      throw draftLimitError(
        "draft のファイル数または合計サイズが上限を超えています",
      );
    }
    const buffer = await readFile(full);
    try {
      collected.files[key] = new TextDecoder("utf-8", { fatal: true }).decode(
        buffer,
      );
    } catch {
      collected.binaryFiles[key] = buffer.toString("base64");
    }
  }
  return collected;
}

export async function measureDraft(
  dir: string,
  base: string = dir,
  sizes: Map<string, number> = new Map(),
): Promise<Map<string, number>> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await measureDraft(full, base, sizes);
    } else if (entry.isFile()) {
      const info = await stat(full);
      sizes.set(relative(base, full).split(sep).join("/"), info.size);
    }
  }
  return sizes;
}

export async function scanBundleExternalUrls(
  bundleDir: string,
  skipRelative: string | undefined,
  dir: string = bundleDir,
  budget: DraftBudget = { files: 0, bytes: 0 },
): Promise<CompositionIssue[]> {
  const issues: CompositionIssue[] = [];
  if (budget.bytes > MAX_DRAFT_TOTAL_BYTES) {
    return issues;
  }
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (budget.bytes > MAX_DRAFT_TOTAL_BYTES) {
      return issues;
    }
    const full = join(dir, entry.name);
    const key = relative(bundleDir, full).split(sep).join("/");
    if (entry.isDirectory()) {
      issues.push(
        ...(await scanBundleExternalUrls(
          bundleDir,
          skipRelative,
          full,
          budget,
        )),
      );
      continue;
    }
    if (!entry.isFile() || key === skipRelative || key === "manifest.json") {
      continue;
    }
    const info = await stat(full);
    if (info.size > MAX_DEPENDENCY_SCAN_BYTES) {
      continue;
    }
    budget.bytes += info.size;
    const buffer = await readFile(full);
    if (buffer.includes(0)) {
      continue;
    }
    const hit = findExternalUrl(buffer.toString("utf-8"));
    if (hit !== undefined) {
      issues.push({
        path: ["dependencies"],
        code: "external_url",
        message: `'${key}' に外部URLが含まれます: ${hit}`,
      });
    }
  }
  return issues;
}

export function assertSafeRelativePath(
  relativePath: string,
  label: string,
): void {
  if (
    relativePath.length === 0 ||
    relativePath === "." ||
    isAbsolute(relativePath) ||
    relativePath.split(/[\\/]/).includes("..")
  ) {
    throw new Error(`Invalid ${label}: ${relativePath}`);
  }
}

export const DRAFT_DEFAULT_DURATION_MS = 5000;

export function buildDefaultEntryHtml(
  runtimeCompositionId: string,
  dimensions: { width: number; height: number },
): string {
  const attr = escapeHtmlAttribute(runtimeCompositionId);
  const jsKey = JSON.stringify(runtimeCompositionId).replace(/</g, "\\u003c");
  const durationSec = toSecondsText(DRAFT_DEFAULT_DURATION_MS);
  const timeline = `{ duration: function () { return ${durationSec}; }, totalTime: function (t) { return t === undefined ? 0 : this; }, seek: function () { return this; }, play: function () { return this; }, pause: function () { return this; } }`;
  return `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="app" data-composition-id="${attr}" data-width="${dimensions.width}" data-height="${dimensions.height}" data-duration="${durationSec}" data-fps="${OUTPUT_FPS}"></div><script>window.__timelines = window.__timelines || {};window.__timelines[${jsKey}] = ${timeline};<\/script></body></html>`;
}

export function resolveWithin(
  baseDir: string,
  relativePath: string,
  label: string,
): string {
  assertSafeRelativePath(relativePath, label);
  const base = resolve(baseDir);
  const target = resolve(base, relativePath);
  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error(`Invalid ${label}: ${relativePath}`);
  }
  return target;
}
