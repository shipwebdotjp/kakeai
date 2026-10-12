import { mkdir, readdir, readFile, stat, writeFile, cp } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, dirname, isAbsolute, resolve, sep } from "node:path";
import { prepareHyperframeLintBody, runHyperframeLint } from "@hyperframes/producer";
import { OUTPUT_FPS, OUTPUT_HEIGHT, OUTPUT_WIDTH, escapeHtmlAttribute, toSecondsText } from "@kakeai/video";
import type { PrismaClient } from "../generated/prisma/client.ts";
import {
  type Composition,
  type CompositionDraft,
  type CompositionVersion,
  type CompositionManifest,
  compositionManifestSchema,
} from "@kakeai/contracts";
import { dataDirectories } from "../storage/paths.ts";
import { computeDirectoryHashAndFiles } from "../storage/composition-store.ts";

export interface CompositionServiceDependencies {
  db: PrismaClient;
  dataDir: string;
}

export interface ValidateBundleResult {
  manifest: CompositionManifest;
  contentHash: string;
}

export function parseAndValidateManifest(manifestContent: string): CompositionManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(manifestContent);
  } catch (err) {
    throw new Error(`Manifest is not valid JSON: ${(err as Error).message}`);
  }
  return compositionManifestSchema.parse(raw);
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

export async function validateCompositionBundle(
  bundleDir: string,
  entrypoint: string,
  expectedRuntimeCompositionId: string,
): Promise<ValidateBundleResult> {
  const { bundleHash } = await computeDirectoryHashAndFiles(bundleDir);

  const entryPath = resolveWithin(bundleDir, entrypoint, "entrypoint");
  let entryHtml: string;
  try {
    entryHtml = await readFile(entryPath, "utf-8");
  } catch {
    throw new Error(`Entrypoint file '${entrypoint}' does not exist in bundle`);
  }

  const manifestPath = join(bundleDir, "manifest.json");
  let manifestContent: string;
  try {
    manifestContent = await readFile(manifestPath, "utf-8");
  } catch {
    throw new Error("Bundle missing 'manifest.json'");
  }

  const manifest = parseAndValidateManifest(manifestContent);

  if (manifest.entrypoint !== entrypoint) {
    throw new Error(`Manifest entrypoint '${manifest.entrypoint}' does not match specified entrypoint '${entrypoint}'`);
  }
  if (manifest.runtimeCompositionId !== expectedRuntimeCompositionId) {
    throw new Error(`Manifest runtimeCompositionId '${manifest.runtimeCompositionId}' does not match expected '${expectedRuntimeCompositionId}'`);
  }
  if (manifest.width !== OUTPUT_WIDTH || manifest.height !== OUTPUT_HEIGHT) {
    throw new Error(`Composition dimensions must be ${OUTPUT_WIDTH}x${OUTPUT_HEIGHT} (got ${manifest.width}x${manifest.height})`);
  }
  if (typeof manifest.durationMs !== "number" || manifest.durationMs <= 0 || !Number.isFinite(manifest.durationMs)) {
    throw new Error(`Composition durationMs must be a positive finite number (got ${manifest.durationMs})`);
  }

  if (entryHtml.includes("<audio") || entryHtml.includes("<bgsound") || /<source[^>]+type=["']audio\//i.test(entryHtml)) {
    throw new Error("Audio tracks or elements are not allowed in composition bundle");
  }

  const lintInput = prepareHyperframeLintBody({ html: entryHtml, entryFile: entrypoint });
  if ("error" in lintInput) {
    throw new Error(`Cannot lint composition entrypoint '${entrypoint}': ${lintInput.error}`);
  }
  let lintResult: Awaited<ReturnType<typeof runHyperframeLint>>;
  try {
    lintResult = await runHyperframeLint(lintInput.prepared);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot lint composition entrypoint '${entrypoint}': ${detail}`);
  }
  if (!lintResult.ok) {
    const details = lintResult.findings
      .filter((finding) => finding.severity === "error")
      .slice(0, 5)
      .map((finding) => `${finding.code}: ${finding.message}`)
      .join("; ") || `${lintResult.errorCount} error(s)`;
    throw new Error(
      `Composition entrypoint '${entrypoint}' has ${lintResult.errorCount} HyperFrames lint errors: ${details}`,
    );
  }

  for (const dep of manifest.dependencies) {
    const depPath = resolveWithin(bundleDir, dep, "dependency");
    try {
      await stat(depPath);
    } catch {
      throw new Error(`Dependency '${dep}' listed in manifest does not exist in bundle`);
    }
  }

  return {
    manifest,
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
      throw new Error(`Composition not found: ${id}`);
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
    input: { entrypoint?: string; files?: Record<string, string> },
  ): Promise<CompositionDraft> {
    const composition = await this.getCompositionById(compositionId);
    if (!composition.draft) {
      throw new Error(`Composition ${compositionId} has no active draft`);
    }

    const draftDir = join(dataDirectories(this.dataDir).root, composition.draft.storageKey);
    await mkdir(draftDir, { recursive: true });

    if (input.files) {
      for (const [relPath, content] of Object.entries(input.files)) {
        const filePath = resolveWithin(draftDir, relPath, "file path");
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, content, "utf-8");
      }
    }

    if (input.entrypoint !== undefined) {
      resolveWithin(draftDir, input.entrypoint, "entrypoint");
    }

    const updatedEntrypoint = input.entrypoint ?? composition.draft.entrypoint;
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

  async publish(
    compositionId: string,
    input: { entrypoint?: string },
  ): Promise<CompositionVersion> {
    const composition = await this.getCompositionById(compositionId);
    if (!composition.draft) {
      throw new Error(`Composition ${compositionId} has no active draft`);
    }

    const entrypoint = input.entrypoint ?? composition.draft.entrypoint;
    const draftDir = join(dataDirectories(this.dataDir).root, composition.draft.storageKey);

    const { manifest, contentHash } = await validateCompositionBundle(
      draftDir,
      entrypoint,
      composition.runtimeCompositionId,
    );

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
      throw new Error(`CompositionVersion not found: ${versionId}`);
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
}
