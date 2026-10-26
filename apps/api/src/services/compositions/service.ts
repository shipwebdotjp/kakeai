import {
  DRAFT_DEFAULT_DURATION_MS,
  MAX_DRAFT_FILES,
  MAX_DRAFT_FILE_BYTES,
  MAX_DRAFT_TOTAL_BYTES,
  assertSafeRelativePath,
  assertStyleKitIntact,
  authoredProvenanceOf,
  buildDefaultEntryHtml,
  collectDraftFiles,
  compositionValidationError,
  draftLimitError,
  draftNotFound,
  invalidPathError,
  measureDraft,
  parseManifestIssues,
  resolveWithin,
  toCompositionDraftDto,
  toCompositionVersionDto,
  type CompositionDraftRow,
  type CompositionServiceDependencies,
  type CompositionVersionRow,
} from "./shared";
import { getCompositionDurationsByVersionId } from "./queries";
import { validateCompositionBundle } from "./validate";
import { mkdir, readFile, rm, stat, writeFile, cp } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, dirname, relative, sep } from "node:path";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import {
  type CanvasProfile,
  type Composition,
  type CompositionDraft,
  type CompositionDraftFiles,
  type CompositionVersion,
  type CompositionManifest,
  type CompositionAuthoredStyleProvenance,
  AUTHORING_STYLE_DIRECTORY,
  CANVAS_PROFILE_DIMENSIONS,
  DEFAULT_CANVAS_PROFILE,
  canvasProfileOf,
  compositionDraftFilesSchema,
} from "@kakeai/contracts";
import { dataDirectories } from "../../storage/paths.ts";
import { computeDirectoryHashAndFiles } from "../../storage/composition-store.ts";
import { ApiError } from "../../http/errors.ts";
import { assertNotProtectedStylePath } from "../style-kit.ts";

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
    canvasProfile?: CanvasProfile;
    authoringStyle?: {
      provenance: CompositionAuthoredStyleProvenance;
      kitFiles: Record<string, string>;
    };
  }): Promise<Composition> {
    const entrypoint = input.entrypoint ?? "index.html";
    assertSafeRelativePath(entrypoint, "entrypoint");
    assertNotProtectedStylePath(entrypoint);
    const canvasProfile = input.canvasProfile ?? DEFAULT_CANVAS_PROFILE;
    const dimensions = CANVAS_PROFILE_DIMENSIONS[canvasProfile];
    const existing = await this.db.composition.findUnique({
      where: { runtimeCompositionId: input.runtimeCompositionId },
    });
    if (existing) {
      throw new Error(
        `Composition with runtimeCompositionId '${input.runtimeCompositionId}' already exists`,
      );
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

    const defaultHtml = buildDefaultEntryHtml(
      input.runtimeCompositionId,
      dimensions,
    );
    const defaultManifest = {
      entrypoint,
      contentHash: "draft",
      runtimeCompositionId: input.runtimeCompositionId,
      canvasProfile,
      width: dimensions.width,
      height: dimensions.height,
      durationMs: DRAFT_DEFAULT_DURATION_MS,
      dependencies: [],
    };

    const entryPath = resolveWithin(draftDir, entrypoint, "entrypoint");
    await mkdir(dirname(entryPath), { recursive: true });
    await writeFile(entryPath, defaultHtml, "utf-8");
    await writeFile(
      join(draftDir, "manifest.json"),
      JSON.stringify(defaultManifest, null, 2),
      "utf-8",
    );

    if (input.authoringStyle !== undefined) {
      const kitRoot = join(draftDir, AUTHORING_STYLE_DIRECTORY);
      for (const [relPath, content] of Object.entries(
        input.authoringStyle.kitFiles,
      )) {
        assertSafeRelativePath(relPath, "style kit file");
        const filePath = resolveWithin(kitRoot, relPath, "style kit file");
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, content, "utf-8");
      }
    }

    await this.db.compositionDraft.create({
      data: {
        compositionId: composition.id,
        entrypoint,
        storageKey: draftStorageKey,
        authoringStyleJson: JSON.stringify(
          input.authoringStyle?.provenance ?? { kind: "neutral" },
        ),
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
      throw new ApiError(404, "RESOURCE_NOT_FOUND", undefined, {
        resource: "composition",
        id,
      });
    }

    return {
      id: composition.id,
      name: composition.name,
      runtimeCompositionId: composition.runtimeCompositionId,
      createdAt: composition.createdAt.toISOString(),
      updatedAt: composition.updatedAt.toISOString(),
      draft: composition.draft
        ? toCompositionDraftDto(composition.draft)
        : null,
      versions: composition.versions.map(toCompositionVersionDto),
    };
  }

  async resolvePublishedBundle(
    versionId: string,
  ): Promise<{ version: CompositionVersion; bundleDir: string }> {
    const version = await this.getVersionById(versionId);
    const bundleDir = join(
      dataDirectories(this.dataDir).root,
      version.storageKey,
    );
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

    return compositions.map(
      (composition: {
        id: string;
        name: string;
        runtimeCompositionId: string;
        createdAt: Date;
        updatedAt: Date;
        draft: CompositionDraftRow | null;
        versions: CompositionVersionRow[];
      }) => ({
        id: composition.id,
        name: composition.name,
        runtimeCompositionId: composition.runtimeCompositionId,
        createdAt: composition.createdAt.toISOString(),
        updatedAt: composition.updatedAt.toISOString(),
        draft: composition.draft
          ? toCompositionDraftDto(composition.draft)
          : null,
        versions: composition.versions.map(toCompositionVersionDto),
      }),
    );
  }

  async updateDraft(
    compositionId: string,
    input: {
      entrypoint?: string;
      files?: Record<string, string>;
      filesBase64?: Record<string, string>;
      manifest?: {
        durationMs?: number;
        dependencies?: string[];
        canvasProfile?: CanvasProfile;
      };
    },
  ): Promise<CompositionDraft> {
    const composition = await this.getCompositionById(compositionId);
    if (!composition.draft) {
      throw draftNotFound(compositionId);
    }

    const draftDir = join(
      dataDirectories(this.dataDir).root,
      composition.draft.storageKey,
    );
    await mkdir(draftDir, { recursive: true });

    const normalizeKey = (key: string): string => {
      let filePath: string;
      try {
        filePath = resolveWithin(draftDir, key, "file path");
      } catch {
        throw invalidPathError(key, "file path");
      }
      const normalized = relative(draftDir, filePath).split(sep).join("/");
      assertNotProtectedStylePath(normalized);
      return normalized;
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
        if (
          !/^[A-Za-z0-9+/]*={0,2}$/.test(sanitized) ||
          sanitized.length % 4 !== 0
        ) {
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
      let totalBytes = [...existingSizes.values()].reduce(
        (sum, size) => sum + size,
        0,
      );
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
        throw draftLimitError(
          "draft のファイル数または合計サイズが上限を超えています",
        );
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
      let normalizedEntrypoint: string;
      try {
        normalizedEntrypoint = relative(
          draftDir,
          resolveWithin(draftDir, input.entrypoint, "entrypoint"),
        )
          .split(sep)
          .join("/");
      } catch {
        throw invalidPathError(input.entrypoint, "entrypoint");
      }
      assertNotProtectedStylePath(normalizedEntrypoint);
    }

    const updatedEntrypoint = input.entrypoint ?? composition.draft.entrypoint;

    if (input.manifest !== undefined) {
      const existing = await this.readDraftManifest(draftDir);
      const canvasProfile =
        input.manifest.canvasProfile ??
        (existing ? canvasProfileOf(existing) : DEFAULT_CANVAS_PROFILE);
      const dimensions = CANVAS_PROFILE_DIMENSIONS[canvasProfile];
      const manifest: CompositionManifest = {
        entrypoint: updatedEntrypoint,
        contentHash: "draft",
        runtimeCompositionId: composition.runtimeCompositionId,
        canvasProfile,
        width: dimensions.width,
        height: dimensions.height,
        durationMs:
          input.manifest.durationMs ??
          existing?.durationMs ??
          DRAFT_DEFAULT_DURATION_MS,
        dependencies:
          input.manifest.dependencies ?? existing?.dependencies ?? [],
      };
      await writeFile(
        join(draftDir, "manifest.json"),
        JSON.stringify(manifest, null, 2),
        "utf-8",
      );
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

  private async readDraftManifest(
    draftDir: string,
  ): Promise<CompositionManifest | undefined> {
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
    const draftDir = join(
      dataDirectories(this.dataDir).root,
      composition.draft.storageKey,
    );
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
    const draftDir = join(
      dataDirectories(this.dataDir).root,
      composition.draft.storageKey,
    );
    await assertStyleKitIntact(draftDir, composition.draft.styleProvenance);
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
    const draftDir = join(
      dataDirectories(this.dataDir).root,
      composition.draft.storageKey,
    );

    const draftProvenance = composition.draft.styleProvenance ?? {
      kind: "neutral" as const,
    };
    const authored = authoredProvenanceOf(draftProvenance);
    await assertStyleKitIntact(draftDir, draftProvenance);

    const { manifest: draftManifest, contentHash } =
      await validateCompositionBundle(
        draftDir,
        entrypoint,
        composition.runtimeCompositionId,
      );
    const manifest: CompositionManifest = { ...draftManifest, contentHash };

    const latestVersion =
      composition.versions && composition.versions.length > 0
        ? Math.max(...composition.versions.map((v) => v.versionNumber))
        : 0;
    const nextVersionNumber = latestVersion + 1;

    const versionId = randomUUID();
    const versionStorageKey = `compositions/bundles/${contentHash}/${versionId}`;
    const versionDir = join(
      dataDirectories(this.dataDir).root,
      versionStorageKey,
    );

    // The bundle copy, the version row, the composition timestamp and the
    // response mapping are one unit: if any of them fails, neither a version
    // nor a bundle is left behind. A half written publish would let a retry
    // create a second version.
    try {
      await mkdir(dirname(versionDir), { recursive: true });
      await cp(draftDir, versionDir, { recursive: true });

      return await this.db.$transaction(async (transaction) => {
        const createdVersion = await transaction.compositionVersion.create({
          data: {
            id: versionId,
            compositionId,
            versionNumber: nextVersionNumber,
            bundleHash: contentHash,
            storageKey: versionStorageKey,
            manifestJson: JSON.stringify(manifest),
            styleProvenanceJson: JSON.stringify(
              authored ?? { kind: "neutral" },
            ),
          },
        });

        await transaction.composition.update({
          where: { id: compositionId },
          data: { updatedAt: new Date() },
        });

        return toCompositionVersionDto(createdVersion);
      });
    } catch (error) {
      // The bundle copy has no row without the transaction, so it is removed
      // again instead of leaving a dead bundle behind.
      await rm(versionDir, { recursive: true, force: true }).catch(
        () => undefined,
      );
      throw error;
    }
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
    return toCompositionVersionDto(v);
  }

  async getDurationsByVersionId(
    versionIds: string[],
  ): Promise<Map<string, number>> {
    return getCompositionDurationsByVersionId(this.db, versionIds);
  }
}
