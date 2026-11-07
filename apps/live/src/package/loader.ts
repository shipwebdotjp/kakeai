import { readFile, realpath, lstat } from "node:fs/promises";
import { resolve } from "node:path";
import {
  livePackageRelativePathSchema,
  type LiveCharacterSheet,
  type LivePackageManifest,
  type LivePackageShow,
} from "@kakeai/contracts";
import { packageError } from "./errors.ts";
import { assertInsideRoot, resolveContainedPath, walkPackageFiles } from "./paths.ts";
import {
  manifestFileMap,
  readCharacters,
  readManifest,
  readShow,
  verifyFileIntegrity,
  verifyFileSet,
  verifyManifestKinds,
  verifyPackageContent,
} from "./verify.ts";

export interface LoadedLivePackage {
  rootDir: string;
  manifest: LivePackageManifest;
  show: LivePackageShow;
  characters: LiveCharacterSheet;
  themeCss: string;
  /** Package-relative path -> absolute path for files listed in the manifest. */
  filesByPath: ReadonlyMap<string, string>;
  warnings: string[];
}

export interface LoadLivePackageOptions {
  onWarning?: (warning: string) => void;
}

async function assertDirectory(rootDir: string): Promise<void> {
  let info;
  try {
    info = await lstat(rootDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw packageError("not_found", `ライブパッケージが見つかりません: ${rootDir}`);
    }
    throw error;
  }
  if (info.isSymbolicLink()) {
    throw packageError("symlink", `ライブパッケージのルートがシンボリックリンクです: ${rootDir}`);
  }
  if (!info.isDirectory()) {
    throw packageError("not_a_directory", `ライブパッケージがディレクトリではありません: ${rootDir}`);
  }
}

/**
 * Validates and loads an exported live package. The package is immutable:
 * verification happens once at startup, and file serving only exposes paths
 * that the manifest lists.
 */
export async function loadLivePackage(
  rootDir: string,
  options: LoadLivePackageOptions = {},
): Promise<LoadedLivePackage> {
  const root = resolve(rootDir);
  await assertDirectory(root);

  const manifest = await readManifest(root);
  const actualFiles = await walkPackageFiles(root);
  verifyFileSet(actualFiles, manifest);
  const digests = await verifyFileIntegrity(root, manifest);
  verifyManifestKinds(manifest);

  const show = await readShow(root);
  const characters = await readCharacters(root);
  const warnings = verifyPackageContent(manifest, show, characters, digests);

  const themeEntry = manifest.files.find((file) => file.path === show.show.theme);
  if (themeEntry === undefined) {
    throw packageError("reference_missing", `テーマ CSS が manifest にありません: ${show.show.theme}`);
  }
  const themeCss = await readFile(resolveContainedPath(root, themeEntry.path), "utf8");

  const filesByPath = new Map<string, string>();
  for (const file of manifest.files) {
    filesByPath.set(file.path, resolveContainedPath(root, file.path));
  }

  for (const warning of warnings) {
    options.onWarning?.(warning);
  }

  return {
    rootDir: root,
    manifest,
    show,
    characters,
    themeCss,
    filesByPath,
    warnings,
  };
}

/**
 * Resolves a package-relative path for HTTP serving. Only manifest-listed
 * files are exposed, and the real path is re-checked so a replaced symlink
 * cannot escape the package root.
 */
export async function resolvePackageFilePath(
  loaded: LoadedLivePackage,
  relativePath: string,
): Promise<string> {
  const parsed = livePackageRelativePathSchema.safeParse(relativePath);
  if (!parsed.success) {
    throw packageError("unsafe_path", `パッケージ内のパスが不正です: ${relativePath}`);
  }
  const listed = loaded.filesByPath.get(parsed.data);
  if (listed === undefined) {
    throw packageError(
      "reference_missing",
      `manifest にないファイルは配信できません: ${parsed.data}`,
      parsed.data,
    );
  }
  const [actual, canonicalRoot] = await Promise.all([
    realpath(listed),
    realpath(loaded.rootDir),
  ]);
  // realpath both sides so macOS `/var` vs `/private/var` cannot cause a
  // false rejection or a false acceptance.
  assertInsideRoot(canonicalRoot, actual, parsed.data);
  return actual;
}

export function packageFileEntries(loaded: LoadedLivePackage) {
  return manifestFileMap(loaded.manifest);
}

export const resolvePackageFile = resolvePackageFilePath;

export { LivePackageError, isPackageError } from "./errors.ts";
export type { LivePackageErrorCode } from "./errors.ts";
