#!/usr/bin/env node
/**
 * Keeps production source files from silently growing back into monoliths.
 *
 * - > 600 lines: warning
 * - > 800 lines: error
 * - Files in BASELINE may stay at their recorded size, but may not grow.
 *   Remove an entry after splitting the file.
 *
 * Tests, generated Prisma code, and build output are excluded.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const WARN_LINES = 600;
const FAIL_LINES = 800;

/** Recorded line-count ceilings; re-record (or remove) an entry after splitting a file. */
const BASELINE = new Map([
  ["apps/web/src/components/SceneEditor.tsx", 1506],
  ["apps/web/src/components/CueList.tsx", 1425],
  ["apps/web/src/pages/ThemeDetailPage.tsx", 1041],
  ["apps/web/src/pages/ThumbnailsPage.tsx", 880],
  ["apps/web/src/components/lines-editor/LineEditor.tsx", 860],
  ["apps/api/src/agent/operations.ts", 856],
  ["apps/web/src/pages/WorkEditPage.tsx", 830],
]);

const EXCLUDED_DIRS = new Set(["node_modules", "generated", "dist", ".git"]);

async function walk(dir, out) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) await walk(join(dir, entry.name), out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    if (/\.test\.(ts|tsx)$/.test(entry.name)) continue;
    out.push(join(dir, entry.name));
  }
}

async function countLines(path) {
  const text = await readFile(path, "utf8");
  return text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;
}

const files = [];
for (const workspace of ["packages", "apps"]) {
  for (const entry of await readdir(join(ROOT, workspace), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const src = join(ROOT, workspace, entry.name, "src");
    try {
      if ((await stat(src)).isDirectory()) await walk(src, files);
    } catch {
      // workspace has no src directory
    }
  }
}

const warnings = [];
const errors = [];
for (const file of files.sort()) {
  const rel = relative(ROOT, file).split(sep).join("/");
  const lines = await countLines(file);
  const baseline = BASELINE.get(rel);
  if (baseline !== undefined) {
    if (lines > baseline) {
      errors.push(`${rel}: ${lines} lines (baseline ${baseline}) — file grew; split it or lower the baseline`);
    }
    continue;
  }
  if (lines > FAIL_LINES) {
    errors.push(`${rel}: ${lines} lines (limit ${FAIL_LINES})`);
  } else if (lines > WARN_LINES) {
    warnings.push(`${rel}: ${lines} lines (limit ${WARN_LINES})`);
  }
}

for (const warning of warnings) console.warn(`warning: ${warning}`);
for (const error of errors) console.error(`error: ${error}`);

if (errors.length > 0) {
  console.error(`\n${errors.length} file size violation(s).`);
  process.exit(1);
}
if (warnings.length > 0) {
  console.warn(`\n${warnings.length} file size warning(s).`);
}
console.log(`file size check passed (${files.length} files).`);
