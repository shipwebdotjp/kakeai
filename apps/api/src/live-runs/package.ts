import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import {
  idSchema,
  liveExportResultSchema,
  livePackageManifestSchema,
  livePackageShowSchema,
  type LivePackageBuild,
  type LivePackageManifest,
} from "@kakeai/contracts";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { ApiError } from "../http/errors.ts";

export interface ProgramVersionHashes {
  id: string;
  programId: string;
  documentSha256: string;
  resolutionSnapshotSha256: string;
}

function invalid(message: string): never {
  throw new ApiError(422, "LIVE_RUN_PACKAGE_INVALID", message);
}

async function readJson(path: string, label: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    invalid(`${label} を読めません: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    invalid(`${label} が JSON ではありません。`);
  }
}

/** Only the binding field is needed; strict parsing rejects a cast-shaped value. */
const liveExportSnapshotBindingSchema = z.object({
  programVersionId: idSchema,
});

async function canonicalPath(path: string): Promise<string | null> {
  try {
    return await realpath(resolve(path));
  } catch {
    return null;
  }
}

/**
 * A Run may only play a package that the exporter actually produced for this
 * Program Version. Checking the manifest alone would accept any hand-written
 * directory that copied the source hashes.
 */
async function verifySucceededExportJob(
  prisma: PrismaClient,
  packageBuild: LivePackageBuild,
  version: ProgramVersionHashes,
  packagePath: string,
): Promise<void> {
  // A symlinked tmp/data path may have been stored by the exporter with its
  // literal form while verification compares realpaths; search both.
  const requestedPath = resolve(packageBuild.packagePath);
  const pathCandidates = [...new Set([requestedPath, packagePath])];
  const jobs = await prisma.job.findMany({
    where: {
      kind: "live_export",
      status: "succeeded",
      // Narrow to this version first; the path match below is only a cheap
      // prefilter and every candidate is still parsed and compared exactly.
      inputSnapshotJson: { contains: version.id },
      OR: pathCandidates.map((path) => ({ resultJson: { contains: path } })),
    },
    // A valid build may be much older than the newest exports. Keep the scan
    // bounded but large enough that ordinary history cannot hide it, and make
    // the order deterministic for equal timestamps.
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 500,
  });
  for (const job of jobs) {
    if (job.resultJson === null) {
      continue;
    }
    let resultJson: unknown;
    let snapshotJson: unknown;
    try {
      resultJson = JSON.parse(job.resultJson);
      snapshotJson = JSON.parse(job.inputSnapshotJson);
    } catch {
      continue;
    }
    const result = liveExportResultSchema.safeParse(resultJson);
    if (!result.success) {
      continue;
    }
    const snapshot = liveExportSnapshotBindingSchema.safeParse(snapshotJson);
    if (!snapshot.success || snapshot.data.programVersionId !== version.id) {
      continue;
    }
    if (result.data.packagePath === null) {
      continue;
    }
    const resultPackagePath = await canonicalPath(result.data.packagePath);
    if (
      result.data.packageId === packageBuild.packageId &&
      result.data.manifestSha256 === packageBuild.manifestSha256 &&
      resultPackagePath === packagePath
    ) {
      return;
    }
  }
  invalid(
    "ライブパッケージが、指定された版の成功した書き出し Job の成果物と一致しません。",
  );
}

/**
 * Verifies that a Run references a v2 package build produced from the exact
 * Program Version. The cheap checks (manifest source, hashes, show schema) run
 * on every creation and again before launch so a changed package cannot be
 * played by an old Run.
 */
export async function verifyRunPackageBuild(
  prisma: PrismaClient,
  packageBuild: LivePackageBuild,
  version: ProgramVersionHashes,
): Promise<LivePackageManifest> {
  // Resolve the requested path once so a symlinked package path and the
  // exporter's Job result are compared canonically.
  const packagePath = await canonicalPath(packageBuild.packagePath);
  if (packagePath === null) {
    invalid(`ライブパッケージが見つかりません: ${packageBuild.packagePath}`);
  }
  let info;
  try {
    info = await lstat(packagePath);
  } catch {
    invalid(`ライブパッケージが見つかりません: ${packagePath}`);
  }
  if (!info.isDirectory()) {
    invalid(`ライブパッケージがディレクトリではありません: ${packagePath}`);
  }

  // Read the manifest bytes once: hashing one read and parsing another would
  // let the file change between verification and use (TOCTOU).
  let manifestBytes: Buffer;
  try {
    manifestBytes = await readFile(join(packagePath, "manifest.json"));
  } catch {
    invalid("manifest.json が見つかりません。");
  }
  const manifestSha256 = createHash("sha256").update(manifestBytes).digest("hex");
  if (manifestSha256 !== packageBuild.manifestSha256) {
    invalid("package build の manifestSha256 が実際の manifest.json と一致しません。");
  }

  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(manifestBytes.toString("utf8")) as unknown;
  } catch {
    invalid("manifest.json が JSON ではありません。");
  }
  const parsed = livePackageManifestSchema.safeParse(rawManifest);
  if (!parsed.success) {
    invalid("manifest.json がライブパッケージ契約に一致しません。");
  }
  const manifest = parsed.data;
  if (manifest.packageSchemaVersion !== 2) {
    invalid("Live Run で使えるのは packageSchemaVersion: 2 のパッケージだけです。");
  }
  if (manifest.packageId !== packageBuild.packageId) {
    invalid("packageId が manifest.json と一致しません。");
  }
  if (!("programVersionId" in manifest.source)) {
    invalid("manifest.json の source が Live Program ではありません。");
  }
  if (manifest.source.programVersionId !== version.id) {
    invalid("manifest.json の programVersionId が指定された版と一致しません。");
  }
  if (manifest.source.programId !== version.programId) {
    invalid("manifest.json の programId が指定された版と一致しません。");
  }
  if (manifest.source.programDocumentSha256 !== version.documentSha256) {
    invalid("manifest.json の programDocumentSha256 が指定された版と一致しません。");
  }
  if (manifest.source.resolutionSnapshotSha256 !== version.resolutionSnapshotSha256) {
    invalid("manifest.json の resolutionSnapshotSha256 が指定された版と一致しません。");
  }

  const rawShow = await readJson(join(packagePath, "show.json"), "show.json");
  const show = livePackageShowSchema.safeParse(rawShow);
  if (!show.success) {
    invalid("show.json がライブパッケージ契約に一致しません。");
  }
  if (show.data.schemaVersion !== 2) {
    invalid("show.json が v2 ではありません。");
  }
  await verifySucceededExportJob(prisma, packageBuild, version, packagePath);
  return manifest;
}
