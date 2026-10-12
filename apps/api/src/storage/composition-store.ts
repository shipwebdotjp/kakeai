import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, relative, isAbsolute } from "node:path";

export function computeDirectoryHashAndFiles(
  dirPath: string,
): Promise<{ bundleHash: string; fileHashes: Map<string, string> }> {
  return (async () => {
    const fileHashes = new Map<string, string>();
    const hashStream = createHash("sha256");

    async function walk(currentDir: string): Promise<string[]> {
      const entries = await readdir(currentDir, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      const relPaths: string[] = [];
      for (const entry of entries) {
        const fullPath = join(currentDir, entry.name);
        if (entry.isDirectory()) {
          relPaths.push(...(await walk(fullPath)));
        } else if (entry.isFile()) {
          const relPath = relative(dirPath, fullPath).replace(/\\/g, "/");
          relPaths.push(relPath);
        }
      }
      return relPaths;
    }

    const relFiles = await walk(dirPath);
    relFiles.sort();

    for (const relFile of relFiles) {
      const content = await readFile(join(dirPath, relFile));
      const fileHash = createHash("sha256").update(content).digest("hex");
      fileHashes.set(relFile, fileHash);
      hashStream.update(relFile);
      hashStream.update(":");
      hashStream.update(fileHash);
      hashStream.update("\n");
    }

    const bundleHash = hashStream.digest("hex");
    return { bundleHash, fileHashes };
  })();
}

export function assertRelativePath(storageKey: string): void {
  if (isAbsolute(storageKey) || storageKey.includes("..")) {
    throw new Error(`Invalid storage key: ${storageKey}`);
  }
}
