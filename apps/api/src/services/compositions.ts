import { mkdir, readdir, readFile, stat, writeFile, cp } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { prepareHyperframeLintBody, runHyperframeLint } from "@hyperframes/producer";
import { OUTPUT_FPS, OUTPUT_HEIGHT, OUTPUT_WIDTH, escapeHtmlAttribute, toSecondsText } from "@kakeai/video";
import type { PrismaClient } from "../generated/prisma/client.ts";
import {
  type Composition,
  type CompositionDraft,
  type CompositionDraftFiles,
  type CompositionVersion,
  type CompositionManifest,
  type ContentDocument,
  compositionDraftFilesSchema,
  compositionFullBleedInputSchema,
  compositionManifestSchema,
  collectNestedCompositionVersionIds,
  getVisualTemplate,
} from "@kakeai/contracts";
import { dataDirectories } from "../storage/paths.ts";
import { computeDirectoryHashAndFiles } from "../storage/composition-store.ts";
import { ApiError } from "../http/errors.ts";

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

const MAX_LINT_ISSUES = 20;
const MAX_DRAFT_FILES = 256;
const MAX_DRAFT_FILE_BYTES = 4_000_000;
const MAX_DRAFT_TOTAL_BYTES = 16_000_000;
const MAX_DEPENDENCY_SCAN_BYTES = 2_000_000;

function compositionValidationError(issues: CompositionIssue[]): ApiError {
  return new ApiError(422, "VALIDATION_ERROR", undefined, { issues });
}

function draftLimitError(message: string): ApiError {
  return compositionValidationError([{ path: ["files"], code: "draft_too_large", message }]);
}

function draftNotFound(compositionId: string): ApiError {
  return new ApiError(404, "RESOURCE_NOT_FOUND", undefined, {
    resource: "composition_draft",
    id: compositionId,
  });
}

function invalidPathError(relPath: string, label: string): ApiError {
  return compositionValidationError([
    { path: ["files", relPath], code: "invalid_path", message: `${label} '${relPath}' はバンドル内の相対パスにしてください` },
  ]);
}

function parseManifestIssues(manifestContent: string): {
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

const EXTERNAL_URL_PATTERN =
  /(?:src|href|poster)\s*=\s*["']?\s*(?:\/\/|https?:\/\/)|url\(\s*["']?\s*(?:\/\/|https?:\/\/)|@import\s+(?:url\()?\s*["']?\s*(?:\/\/|https?:\/\/)|(?:fetch|import|XMLHttpRequest\.open|WebSocket)\s*\(\s*["']\s*(?:\/\/|https?:\/\/|wss?:\/\/)/i;

function findExternalUrl(content: string): string | undefined {
  const match = content.match(EXTERNAL_URL_PATTERN);
  return match?.[0];
}

function findCompositionId(html: string): string | undefined {
  const match = html.match(/<[^>]*\bdata-composition-id\s*=\s*["']([^"']*)["']/i);
  return match?.[1];
}

interface DraftBudget {
  files: number;
  bytes: number;
}

async function collectDraftFiles(
  dir: string,
  base: string = dir,
  budget: DraftBudget = { files: 0, bytes: 0 },
  collected: { files: Record<string, string>; binaryFiles: Record<string, string> } = {
    files: {},
    binaryFiles: {},
  },
): Promise<{ files: Record<string, string>; binaryFiles: Record<string, string> }> {
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
    if (budget.files > MAX_DRAFT_FILES || budget.bytes > MAX_DRAFT_TOTAL_BYTES) {
      throw draftLimitError("draft のファイル数または合計サイズが上限を超えています");
    }
    const buffer = await readFile(full);
    try {
      collected.files[key] = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch {
      collected.binaryFiles[key] = buffer.toString("base64");
    }
  }
  return collected;
}

async function measureDraft(
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

async function scanBundleExternalUrls(
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
      issues.push(...(await scanBundleExternalUrls(bundleDir, skipRelative, full, budget)));
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

function assertSafeRelativePath(relativePath: string, label: string): void {
  if (
    relativePath.length === 0 ||
    relativePath === "." ||
    isAbsolute(relativePath) ||
    relativePath.split(/[\\/]/).includes("..")
  ) {
    throw new Error(`Invalid ${label}: ${relativePath}`);
  }
}

const DRAFT_DEFAULT_DURATION_MS = 5000;

function buildDefaultEntryHtml(runtimeCompositionId: string): string {
  const attr = escapeHtmlAttribute(runtimeCompositionId);
  const jsKey = JSON.stringify(runtimeCompositionId).replace(/</g, "\\u003c");
  const durationSec = toSecondsText(DRAFT_DEFAULT_DURATION_MS);
  return `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="app" data-composition-id="${attr}" data-width="${OUTPUT_WIDTH}" data-height="${OUTPUT_HEIGHT}" data-duration="${durationSec}" data-fps="${OUTPUT_FPS}"></div><script>window.__timelines = window.__timelines || {};window.__timelines[${jsKey}] = { duration: ${durationSec} };<\/script></body></html>`;
}

function resolveWithin(baseDir: string, relativePath: string, label: string): string {
  assertSafeRelativePath(relativePath, label);
  const base = resolve(baseDir);
  const target = resolve(base, relativePath);
  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error(`Invalid ${label}: ${relativePath}`);
  }
  return target;
}

export function collectCompositionVersionIds(content: ContentDocument): string[] {
  const ids = new Set<string>();
  for (const scene of content.scenes) {
    for (const cue of scene.visualCues) {
      if (cue.template.id === "composition.full-bleed") {
        const parsed = compositionFullBleedInputSchema.safeParse(cue.input);
        if (parsed.success) {
          ids.add(parsed.data.compositionVersionId);
        }
        continue;
      }
      const definition = getVisualTemplate(cue.template.id, cue.template.version);
      if (definition === undefined) {
        continue;
      }
      const parsed = definition.inputSchema.safeParse(cue.input);
      if (!parsed.success) {
        continue;
      }
      for (const versionId of collectNestedCompositionVersionIds(parsed.data)) {
        ids.add(versionId);
      }
    }
  }
  return [...ids];
}

export async function validateCompositionBundle(
  bundleDir: string,
  entrypoint: string,
  expectedRuntimeCompositionId: string,
): Promise<ValidateBundleResult> {
  const issues: CompositionIssue[] = [];
  const { bundleHash } = await computeDirectoryHashAndFiles(bundleDir);

  let entryPath: string | undefined;
  try {
    entryPath = resolveWithin(bundleDir, entrypoint, "entrypoint");
  } catch {
    issues.push({
      path: ["entrypoint"],
      code: "invalid_path",
      message: `entrypoint '${entrypoint}' はバンドル内の相対パスにしてください`,
    });
  }

  let entryHtml: string | undefined;
  if (entryPath !== undefined) {
    try {
      entryHtml = await readFile(entryPath, "utf-8");
    } catch {
      issues.push({
        path: ["entrypoint"],
        code: "missing_entrypoint",
        message: `entrypoint '${entrypoint}' がバンドル内に存在しません`,
      });
    }
  }

  let manifestContent: string | undefined;
  try {
    manifestContent = await readFile(join(bundleDir, "manifest.json"), "utf-8");
  } catch {
    issues.push({
      path: ["manifest"],
      code: "missing_manifest",
      message: "バンドルに 'manifest.json' がありません",
    });
  }

  let manifest: CompositionManifest | undefined;
  if (manifestContent !== undefined) {
    const parsed = parseManifestIssues(manifestContent);
    issues.push(...parsed.issues);
    manifest = parsed.manifest;
  }

  if (manifest !== undefined) {
    if (manifest.entrypoint !== entrypoint) {
      issues.push({
        path: ["manifest", "entrypoint"],
        code: "entrypoint_mismatch",
        message: `manifest の entrypoint '${manifest.entrypoint}' が指定 '${entrypoint}' と一致しません`,
      });
    }
    if (manifest.runtimeCompositionId !== expectedRuntimeCompositionId) {
      issues.push({
        path: ["manifest", "runtimeCompositionId"],
        code: "runtime_composition_id_mismatch",
        message: `manifest の runtimeCompositionId '${manifest.runtimeCompositionId}' が Composition '${expectedRuntimeCompositionId}' と一致しません`,
      });
    }
    if (manifest.width !== OUTPUT_WIDTH || manifest.height !== OUTPUT_HEIGHT) {
      issues.push({
        path: ["manifest", "width"],
        code: "invalid_dimensions",
        message: `寸法は ${OUTPUT_WIDTH}x${OUTPUT_HEIGHT} である必要があります（現在 ${manifest.width}x${manifest.height}）`,
      });
    }
    if (!Number.isFinite(manifest.durationMs) || manifest.durationMs <= 0) {
      issues.push({
        path: ["manifest", "durationMs"],
        code: "invalid_duration",
        message: `durationMs は正の有限値である必要があります（現在 ${manifest.durationMs}）`,
      });
    }
    for (const dep of manifest.dependencies) {
      let depPath: string;
      try {
        depPath = resolveWithin(bundleDir, dep, "dependency");
      } catch {
        issues.push({
          path: ["manifest", "dependencies"],
          code: "invalid_dependency_path",
          message: `依存 '${dep}' はバンドル内の相対パスにしてください`,
        });
        continue;
      }
      try {
        await stat(depPath);
      } catch {
        issues.push({
          path: ["manifest", "dependencies"],
          code: "missing_dependency",
          message: `依存 '${dep}' がバンドル内に存在しません`,
        });
        continue;
      }
    }
  }

  if (entryHtml !== undefined) {
    if (entryHtml.includes("<audio") || entryHtml.includes("<bgsound") || /<source[^>]+type=["']audio\//i.test(entryHtml)) {
      issues.push({
        path: ["entrypoint"],
        code: "audio_not_allowed",
        message: "バンドルに音声要素（audio / bgsound / audio source）を含めることはできません",
      });
    }

    const externalUrl = findExternalUrl(entryHtml);
    if (externalUrl !== undefined) {
      issues.push({
        path: ["entrypoint"],
        code: "external_url",
        message: `外部URLは使用できません: ${externalUrl}（依存はバンドルへ同梱してください）`,
      });
    }

    const compositionId = findCompositionId(entryHtml);
    if (compositionId !== undefined && compositionId !== expectedRuntimeCompositionId) {
      issues.push({
        path: ["entrypoint", "data-composition-id"],
        code: "composition_id_mismatch",
        message: `entry の data-composition-id '${compositionId}' が runtimeCompositionId '${expectedRuntimeCompositionId}' と一致しません`,
      });
    }

    const lintInput = prepareHyperframeLintBody({ html: entryHtml, entryFile: entrypoint });
    if ("error" in lintInput) {
      issues.push({
        path: ["entrypoint"],
        code: "lint_failed",
        message: `HyperFrames lint を実行できません: ${lintInput.error}`,
      });
    } else {
      let lintResult: Awaited<ReturnType<typeof runHyperframeLint>> | undefined;
      try {
        lintResult = await runHyperframeLint(lintInput.prepared);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        issues.push({
          path: ["entrypoint"],
          code: "lint_failed",
          message: `HyperFrames lint を実行できません: ${detail}`,
        });
      }
      if (lintResult !== undefined && !lintResult.ok) {
        for (const finding of lintResult.findings.filter((entry) => entry.severity === "error").slice(0, MAX_LINT_ISSUES)) {
          const location = finding.line === undefined ? "" : ` (line ${finding.line})`;
          issues.push({
            path: ["entrypoint"],
            code: finding.code,
            message: `${finding.message}${location}`,
          });
        }
      }
    }
  }

  const entryRelative =
    entryPath === undefined ? undefined : relative(bundleDir, entryPath).split(sep).join("/");
  issues.push(...(await scanBundleExternalUrls(bundleDir, entryRelative)));

  if (issues.length > 0) {
    throw compositionValidationError(issues);
  }

  return {
    manifest: manifest as CompositionManifest,
    contentHash: bundleHash,
  };
}

export class CompositionService {
  private readonly db: PrismaClient;
  private readonly dataDir: string;

  constructor(deps: CompositionServiceDependencies) {
    this.db = deps.db;
    this.dataDir = deps.dataDir;
  }

  async createComposition(input: {
    name: string;
    runtimeCompositionId: string;
    entrypoint?: string;
  }): Promise<Composition> {
    const entrypoint = input.entrypoint ?? "index.html";
    assertSafeRelativePath(entrypoint, "entrypoint");
    const existing = await this.db.composition.findUnique({
      where: { runtimeCompositionId: input.runtimeCompositionId },
    });
    if (existing) {
      throw new Error(`Composition with runtimeCompositionId '${input.runtimeCompositionId}' already exists`);
    }

    const composition = await this.db.composition.create({
      data: {
        name: input.name,
        runtimeCompositionId: input.runtimeCompositionId,
      },
    });

    const draftStorageKey = `compositions/drafts/${composition.id}`;
    const draftDir = join(dataDirectories(this.dataDir).root, draftStorageKey);
    await mkdir(draftDir, { recursive: true });

    const defaultHtml = buildDefaultEntryHtml(input.runtimeCompositionId);
    const defaultManifest = {
      entrypoint,
      contentHash: "draft",
      runtimeCompositionId: input.runtimeCompositionId,
      width: OUTPUT_WIDTH,
      height: OUTPUT_HEIGHT,
      durationMs: DRAFT_DEFAULT_DURATION_MS,
      dependencies: [],
    };

    const entryPath = resolveWithin(draftDir, entrypoint, "entrypoint");
    await mkdir(dirname(entryPath), { recursive: true });
    await writeFile(entryPath, defaultHtml, "utf-8");
    await writeFile(join(draftDir, "manifest.json"), JSON.stringify(defaultManifest, null, 2), "utf-8");

    await this.db.compositionDraft.create({
      data: {
        compositionId: composition.id,
        entrypoint,
        storageKey: draftStorageKey,
      },
    });

    return this.getCompositionById(composition.id);
  }

  async getCompositionById(id: string): Promise<Composition> {
    const composition = await this.db.composition.findUnique({
      where: { id },
      include: {
        draft: true,
        versions: { orderBy: { versionNumber: "asc" } },
      },
    });

    if (!composition) {
      throw new ApiError(404, "RESOURCE_NOT_FOUND", undefined, { resource: "composition", id });
    }

    return {
      id: composition.id,
      name: composition.name,
      runtimeCompositionId: composition.runtimeCompositionId,
      createdAt: composition.createdAt.toISOString(),
      updatedAt: composition.updatedAt.toISOString(),
      draft: composition.draft
        ? {
            id: composition.draft.id,
            compositionId: composition.draft.compositionId,
            entrypoint: composition.draft.entrypoint,
            storageKey: composition.draft.storageKey,
            updatedAt: composition.draft.updatedAt.toISOString(),
          }
        : null,
      versions: composition.versions.map((v: {
        id: string;
        compositionId: string;
        versionNumber: number;
        bundleHash: string;
        storageKey: string;
        manifestJson: string;
        createdAt: Date;
      }) => ({
        id: v.id,
        compositionId: v.compositionId,
        versionNumber: v.versionNumber,
        bundleHash: v.bundleHash,
        storageKey: v.storageKey,
        manifest: JSON.parse(v.manifestJson),
        createdAt: v.createdAt.toISOString(),
      })),
    };
  }

  async resolvePublishedBundle(
    versionId: string,
  ): Promise<{ version: CompositionVersion; bundleDir: string }> {
    const version = await this.getVersionById(versionId);
    const bundleDir = join(dataDirectories(this.dataDir).root, version.storageKey);
    let info;
    try {
      info = await stat(bundleDir);
    } catch {
      throw new Error(`Composition bundle directory missing: ${versionId}`);
    }
    if (!info.isDirectory()) {
      throw new Error(`Composition bundle directory missing: ${versionId}`);
    }
    const { bundleHash } = await computeDirectoryHashAndFiles(bundleDir);
    if (bundleHash !== version.bundleHash) {
      throw new Error(`Composition bundle hash mismatch: ${versionId}`);
    }
    return { version, bundleDir };
  }

  async listCompositions(): Promise<Composition[]> {
    const compositions = await this.db.composition.findMany({
      include: {
        draft: true,
        versions: { orderBy: { versionNumber: "asc" } },
      },
      orderBy: { updatedAt: "desc" },
    });

    return compositions.map((composition: {
      id: string;
      name: string;
      runtimeCompositionId: string;
      createdAt: Date;
      updatedAt: Date;
      draft: { id: string; compositionId: string; entrypoint: string; storageKey: string; updatedAt: Date } | null;
      versions: Array<{ id: string; compositionId: string; versionNumber: number; bundleHash: string; storageKey: string; manifestJson: string; createdAt: Date }>;
    }) => ({
      id: composition.id,
      name: composition.name,
      runtimeCompositionId: composition.runtimeCompositionId,
      createdAt: composition.createdAt.toISOString(),
      updatedAt: composition.updatedAt.toISOString(),
      draft: composition.draft
        ? {
            id: composition.draft.id,
            compositionId: composition.draft.compositionId,
            entrypoint: composition.draft.entrypoint,
            storageKey: composition.draft.storageKey,
            updatedAt: composition.draft.updatedAt.toISOString(),
          }
        : null,
      versions: composition.versions.map((v) => ({
        id: v.id,
        compositionId: v.compositionId,
        versionNumber: v.versionNumber,
        bundleHash: v.bundleHash,
        storageKey: v.storageKey,
        manifest: JSON.parse(v.manifestJson),
        createdAt: v.createdAt.toISOString(),
      })),
    }));
  }

  async updateDraft(
    compositionId: string,
    input: {
      entrypoint?: string;
      files?: Record<string, string>;
      filesBase64?: Record<string, string>;
      manifest?: { durationMs?: number; dependencies?: string[] };
    },
  ): Promise<CompositionDraft> {
    const composition = await this.getCompositionById(compositionId);
    if (!composition.draft) {
      throw draftNotFound(compositionId);
    }

    const draftDir = join(dataDirectories(this.dataDir).root, composition.draft.storageKey);
    await mkdir(draftDir, { recursive: true });

    const normalizeKey = (key: string): string => {
      let filePath: string;
      try {
        filePath = resolveWithin(draftDir, key, "file path");
      } catch {
        throw invalidPathError(key, "file path");
      }
      return relative(draftDir, filePath).split(sep).join("/");
    };

    const textFiles = new Map<string, string>();
    if (input.files !== undefined) {
      for (const [key, content] of Object.entries(input.files)) {
        const normalized = normalizeKey(key);
        if (textFiles.has(normalized)) {
          throw compositionValidationError([
            {
              path: ["files", normalized],
              code: "duplicate_file",
              message: `'${normalized}' が重複しています`,
            },
          ]);
        }
        textFiles.set(normalized, content);
      }
    }

    const binaryFiles = new Map<string, Buffer>();
    if (input.filesBase64 !== undefined) {
      for (const [key, encoded] of Object.entries(input.filesBase64)) {
        const normalized = normalizeKey(key);
        const sanitized = encoded.replace(/\s/g, "");
        if (Math.floor((sanitized.length * 3) / 4) > MAX_DRAFT_FILE_BYTES) {
          throw draftLimitError(`ファイル '${normalized}' が大きすぎます`);
        }
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(sanitized) || sanitized.length % 4 !== 0) {
          throw compositionValidationError([
            {
              path: ["filesBase64", normalized],
              code: "invalid_base64",
              message: `'${normalized}' は有効なbase64ではありません`,
            },
          ]);
        }
        if (binaryFiles.has(normalized)) {
          throw compositionValidationError([
            {
              path: ["filesBase64", normalized],
              code: "duplicate_file",
              message: `'${normalized}' が重複しています`,
            },
          ]);
        }
        binaryFiles.set(normalized, Buffer.from(sanitized, "base64"));
      }
    }

    for (const key of binaryFiles.keys()) {
      if (textFiles.has(key)) {
        throw compositionValidationError([
          {
            path: ["files", key],
            code: "duplicate_file",
            message: `'${key}' が files と filesBase64 の両方に指定されています`,
          },
        ]);
      }
    }

    const allKeys = new Set([...textFiles.keys(), ...binaryFiles.keys()]);

    if (input.manifest !== undefined && allKeys.has("manifest.json")) {
      throw compositionValidationError([
        {
          path: ["manifest"],
          code: "conflict",
          message: "manifest と files['manifest.json'] は同時に指定できません",
        },
      ]);
    }

    if (allKeys.size > 0) {
      if (allKeys.size > MAX_DRAFT_FILES) {
        throw draftLimitError("draft のファイル数が上限を超えています");
      }
      const existingSizes = await measureDraft(draftDir);
      let totalFiles = existingSizes.size;
      let totalBytes = [...existingSizes.values()].reduce((sum, size) => sum + size, 0);
      const sizes = new Map<string, number>();
      for (const [relPath, content] of textFiles) {
        sizes.set(relPath, Buffer.byteLength(content, "utf-8"));
      }
      for (const [relPath, buffer] of binaryFiles) {
        sizes.set(relPath, buffer.length);
      }
      for (const [relPath, size] of sizes) {
        if (size > MAX_DRAFT_FILE_BYTES) {
          throw draftLimitError(`ファイル '${relPath}' が大きすぎます`);
        }
        if (existingSizes.has(relPath)) {
          totalBytes -= existingSizes.get(relPath) ?? 0;
        } else {
          totalFiles += 1;
        }
        totalBytes += size;
      }
      if (totalFiles > MAX_DRAFT_FILES || totalBytes > MAX_DRAFT_TOTAL_BYTES) {
        throw draftLimitError("draft のファイル数または合計サイズが上限を超えています");
      }
      for (const [relPath, content] of textFiles) {
        const filePath = join(draftDir, relPath);
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, content, "utf-8");
      }
      for (const [relPath, buffer] of binaryFiles) {
        const filePath = join(draftDir, relPath);
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, buffer);
      }
    }

    if (input.entrypoint !== undefined) {
      try {
        resolveWithin(draftDir, input.entrypoint, "entrypoint");
      } catch {
        throw invalidPathError(input.entrypoint, "entrypoint");
      }
    }

    const updatedEntrypoint = input.entrypoint ?? composition.draft.entrypoint;

    if (input.manifest !== undefined) {
      const existing = await this.readDraftManifest(draftDir);
      const manifest: CompositionManifest = {
        entrypoint: updatedEntrypoint,
        contentHash: "draft",
        runtimeCompositionId: composition.runtimeCompositionId,
        width: OUTPUT_WIDTH,
        height: OUTPUT_HEIGHT,
        durationMs: input.manifest.durationMs ?? existing?.durationMs ?? DRAFT_DEFAULT_DURATION_MS,
        dependencies: input.manifest.dependencies ?? existing?.dependencies ?? [],
      };
      await writeFile(join(draftDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");
    }

    const updatedDraftRecord = await this.db.compositionDraft.update({
      where: { compositionId },
      data: {
        entrypoint: updatedEntrypoint,
      },
    });

    await this.db.composition.update({
      where: { id: compositionId },
      data: { updatedAt: new Date() },
    });

    return {
      id: updatedDraftRecord.id,
      compositionId: updatedDraftRecord.compositionId,
      entrypoint: updatedDraftRecord.entrypoint,
      storageKey: updatedDraftRecord.storageKey,
      updatedAt: updatedDraftRecord.updatedAt.toISOString(),
    };
  }

  private async readDraftManifest(draftDir: string): Promise<CompositionManifest | undefined> {
    let content: string;
    try {
      content = await readFile(join(draftDir, "manifest.json"), "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      throw err;
    }
    const parsed = parseManifestIssues(content);
    if (parsed.issues.length > 0) {
      throw compositionValidationError(parsed.issues);
    }
    return parsed.manifest;
  }

  async getDraftFiles(compositionId: string): Promise<CompositionDraftFiles> {
    const composition = await this.getCompositionById(compositionId);
    if (!composition.draft) {
      throw draftNotFound(compositionId);
    }
    const draftDir = join(dataDirectories(this.dataDir).root, composition.draft.storageKey);
    const collected = await collectDraftFiles(draftDir);
    const parsed = compositionDraftFilesSchema.safeParse({
      entrypoint: composition.draft.entrypoint,
      files: collected.files,
      ...(Object.keys(collected.binaryFiles).length > 0
        ? { binaryFiles: collected.binaryFiles }
        : {}),
    });
    if (!parsed.success) {
      throw compositionValidationError(
        parsed.error.issues.map((issue) => ({
          path: issue.path.map((segment) =>
            typeof segment === "symbol" ? segment.toString() : segment,
          ),
          code: issue.code,
          message: issue.message,
        })),
      );
    }
    return parsed.data;
  }

  async validateDraft(
    compositionId: string,
    input: { entrypoint?: string },
  ): Promise<CompositionManifest> {
    const composition = await this.getCompositionById(compositionId);
    if (!composition.draft) {
      throw draftNotFound(compositionId);
    }
    const entrypoint = input.entrypoint ?? composition.draft.entrypoint;
    const draftDir = join(dataDirectories(this.dataDir).root, composition.draft.storageKey);
    const { manifest, contentHash } = await validateCompositionBundle(
      draftDir,
      entrypoint,
      composition.runtimeCompositionId,
    );
    return { ...manifest, contentHash };
  }

  async publish(
    compositionId: string,
    input: { entrypoint?: string },
  ): Promise<CompositionVersion> {
    const composition = await this.getCompositionById(compositionId);
    if (!composition.draft) {
      throw draftNotFound(compositionId);
    }

    const entrypoint = input.entrypoint ?? composition.draft.entrypoint;
    const draftDir = join(dataDirectories(this.dataDir).root, composition.draft.storageKey);

    const { manifest: draftManifest, contentHash } = await validateCompositionBundle(
      draftDir,
      entrypoint,
      composition.runtimeCompositionId,
    );
    const manifest: CompositionManifest = { ...draftManifest, contentHash };

    const latestVersion = composition.versions && composition.versions.length > 0
      ? Math.max(...composition.versions.map((v) => v.versionNumber))
      : 0;
    const nextVersionNumber = latestVersion + 1;

    const versionId = randomUUID();
    const versionStorageKey = `compositions/bundles/${contentHash}/${versionId}`;
    const versionDir = join(dataDirectories(this.dataDir).root, versionStorageKey);

    await mkdir(dirname(versionDir), { recursive: true });
    await cp(draftDir, versionDir, { recursive: true });

    const createdVersion = await this.db.compositionVersion.create({
      data: {
        id: versionId,
        compositionId,
        versionNumber: nextVersionNumber,
        bundleHash: contentHash,
        storageKey: versionStorageKey,
        manifestJson: JSON.stringify(manifest),
      },
    });

    await this.db.composition.update({
      where: { id: compositionId },
      data: { updatedAt: new Date() },
    });

    return {
      id: createdVersion.id,
      compositionId: createdVersion.compositionId,
      versionNumber: createdVersion.versionNumber,
      bundleHash: createdVersion.bundleHash,
      storageKey: createdVersion.storageKey,
      manifest,
      createdAt: createdVersion.createdAt.toISOString(),
    };
  }

  async getVersionById(versionId: string): Promise<CompositionVersion> {
    const v = await this.db.compositionVersion.findUnique({
      where: { id: versionId },
    });
    if (!v) {
      throw new ApiError(404, "RESOURCE_NOT_FOUND", undefined, {
        resource: "composition_version",
        id: versionId,
      });
    }
    return {
      id: v.id,
      compositionId: v.compositionId,
      versionNumber: v.versionNumber,
      bundleHash: v.bundleHash,
      storageKey: v.storageKey,
      manifest: JSON.parse(v.manifestJson),
      createdAt: v.createdAt.toISOString(),
    };
  }

  async getDurationsByVersionId(versionIds: string[]): Promise<Map<string, number>> {
    return getCompositionDurationsByVersionId(this.db, versionIds);
  }
}

export async function getCompositionDurationsByVersionId(
  db: PrismaClient,
  versionIds: string[],
): Promise<Map<string, number>> {
  const uniqueIds = [...new Set(versionIds)];
  if (uniqueIds.length === 0) {
    return new Map();
  }
  const rows = await db.compositionVersion.findMany({ where: { id: { in: uniqueIds } } });
  const durations = new Map<string, number>();
  for (const row of rows) {
    let durationMs: unknown;
    try {
      durationMs = (JSON.parse(row.manifestJson) as { durationMs?: unknown }).durationMs;
    } catch {
      continue;
    }
    if (typeof durationMs === "number" && Number.isFinite(durationMs)) {
      durations.set(row.id, durationMs);
    }
  }
  return durations;
}
