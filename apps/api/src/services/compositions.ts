import { mkdir, readdir, readFile, stat, writeFile, cp } from "node:fs/promises";
import { join, dirname, isAbsolute } from "node:path";
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

export async function validateCompositionBundle(
  bundleDir: string,
  entrypoint: string,
  expectedRuntimeCompositionId: string,
): Promise<ValidateBundleResult> {
  const { bundleHash } = await computeDirectoryHashAndFiles(bundleDir);

  const entryPath = join(bundleDir, entrypoint);
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
  if (manifest.width !== 1920 || manifest.height !== 1080) {
    throw new Error(`Composition dimensions must be 1920x1080 (got ${manifest.width}x${manifest.height})`);
  }
  if (typeof manifest.durationMs !== "number" || manifest.durationMs <= 0 || !Number.isFinite(manifest.durationMs)) {
    throw new Error(`Composition durationMs must be a positive finite number (got ${manifest.durationMs})`);
  }

  if (entryHtml.includes("<audio") || entryHtml.includes("<bgsound") || /<source[^>]+type=["']audio\//i.test(entryHtml)) {
    throw new Error("Audio tracks or elements are not allowed in composition bundle");
  }

  for (const dep of manifest.dependencies) {
    if (isAbsolute(dep) || dep.includes("..")) {
      throw new Error(`Invalid relative dependency in manifest: ${dep}`);
    }
    const depPath = join(bundleDir, dep);
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

    const defaultHtml = `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="app"></div></body></html>`;
    const defaultManifest = {
      entrypoint,
      contentHash: "draft",
      runtimeCompositionId: input.runtimeCompositionId,
      width: 1920,
      height: 1080,
      durationMs: 5000,
      dependencies: [],
    };

    await writeFile(join(draftDir, entrypoint), defaultHtml, "utf-8");
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
        if (isAbsolute(relPath) || relPath.includes("..")) {
          throw new Error(`Invalid file path in draft update: ${relPath}`);
        }
        const filePath = join(draftDir, relPath);
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, content, "utf-8");
      }
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

    const versionStorageKey = `compositions/bundles/${contentHash}`;
    const versionDir = join(dataDirectories(this.dataDir).root, versionStorageKey);

    await mkdir(dirname(versionDir), { recursive: true });
    await cp(draftDir, versionDir, { recursive: true });

    const createdVersion = await this.db.compositionVersion.create({
      data: {
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
