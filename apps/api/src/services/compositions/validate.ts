import {
  MAX_LINT_ISSUES,
  compositionValidationError,
  findCompositionId,
  findEntryDimensions,
  findExternalUrl,
  parseManifestIssues,
  resolveWithin,
  scanBundleExternalUrls,
  type CompositionIssue,
  type ValidateBundleResult,
} from "./shared";
import { readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import {
  prepareHyperframeLintBody,
  runHyperframeLint,
} from "@hyperframes/producer";
import {
  type CompositionManifest,
  type ContentDocument,
  CANVAS_PROFILE_DIMENSIONS,
  canvasProfileOf,
  compositionFullBleedInputSchema,
  collectNestedCompositionVersionIds,
  getVisualTemplate,
} from "@kakeai/contracts";
import { computeDirectoryHashAndFiles } from "../../storage/composition-store.ts";

export function collectCompositionVersionIds(
  content: ContentDocument,
): string[] {
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
      const definition = getVisualTemplate(
        cue.template.id,
        cue.template.version,
      );
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
    const expectedDimensions =
      CANVAS_PROFILE_DIMENSIONS[canvasProfileOf(manifest)];
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
    if (
      manifest.width !== expectedDimensions.width ||
      manifest.height !== expectedDimensions.height
    ) {
      issues.push({
        path: ["manifest", "width"],
        code: "invalid_dimensions",
        message: `寸法は ${expectedDimensions.width}x${expectedDimensions.height} (${canvasProfileOf(manifest)}) である必要があります（現在 ${manifest.width}x${manifest.height}）`,
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
    if (
      entryHtml.includes("<audio") ||
      entryHtml.includes("<bgsound") ||
      /<source[^>]+type=["']audio\//i.test(entryHtml)
    ) {
      issues.push({
        path: ["entrypoint"],
        code: "audio_not_allowed",
        message:
          "バンドルに音声要素（audio / bgsound / audio source）を含めることはできません",
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
    if (
      compositionId !== undefined &&
      compositionId !== expectedRuntimeCompositionId
    ) {
      issues.push({
        path: ["entrypoint", "data-composition-id"],
        code: "composition_id_mismatch",
        message: `entry の data-composition-id '${compositionId}' が runtimeCompositionId '${expectedRuntimeCompositionId}' と一致しません`,
      });
    }

    if (manifest !== undefined) {
      const expected = CANVAS_PROFILE_DIMENSIONS[canvasProfileOf(manifest)];
      const entryDimensions = findEntryDimensions(entryHtml);
      if (entryDimensions !== undefined) {
        const widthMatches = Number(entryDimensions.width) === expected.width;
        const heightMatches =
          Number(entryDimensions.height) === expected.height;
        if (!widthMatches || !heightMatches) {
          issues.push({
            path: ["entrypoint", "data-width"],
            code: "dimension_mismatch",
            message: `entry の data-width/data-height は manifest の寸法 ${expected.width}x${expected.height} と一致する必要があります（現在 ${entryDimensions.width ?? "?"}x${entryDimensions.height ?? "?"}）`,
          });
        }
      }
    }

    const lintInput = prepareHyperframeLintBody({
      html: entryHtml,
      entryFile: entrypoint,
    });
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
        for (const finding of lintResult.findings
          .filter((entry) => entry.severity === "error")
          .slice(0, MAX_LINT_ISSUES)) {
          const location =
            finding.line === undefined ? "" : ` (line ${finding.line})`;
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
    entryPath === undefined
      ? undefined
      : relative(bundleDir, entryPath).split(sep).join("/");
  issues.push(...(await scanBundleExternalUrls(bundleDir, entryRelative)));

  if (issues.length > 0) {
    throw compositionValidationError(issues);
  }

  return {
    manifest: manifest as CompositionManifest,
    contentHash: bundleHash,
  };
}
