import type { LiveAutoProfileResult } from "@kakeai/contracts";

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Human-readable draft summary printed before an export. */
export function formatAutoProfileSummary(
  result: LiveAutoProfileResult,
  options: { savedPath?: string; dryRun?: boolean } = {},
): string {
  const lines: string[] = [];
  lines.push(`[auto-profile] ${result.summary.title}`);
  lines.push(`  target: ${formatDuration(result.summary.targetDurationMs)}`);
  lines.push(
    `  characters: left=${result.summary.characters.left ?? "-"}, right=${result.summary.characters.right ?? "-"}`,
  );
  lines.push("  segments:");
  for (const segment of result.summary.segments) {
    const material =
      segment.materialLabel === null ? "" : `  material=${segment.materialLabel}`;
    lines.push(
      `    ${segment.kind.padEnd(8)} ${segment.label}  ${segment.cueCount} cues${material}`,
    );
  }
  if (result.summary.materials.length > 0) {
    lines.push("  materials:");
    for (const material of result.summary.materials) {
      lines.push(`    ${material.label} (${material.format})`);
    }
  }
  if (result.warnings.length > 0) {
    lines.push("  warnings:");
    for (const warning of result.warnings) {
      lines.push(`    - ${warning}`);
    }
  }
  if (options.savedPath !== undefined) {
    lines.push(`  saved: ${options.savedPath}`);
  }
  if (options.dryRun === true) {
    lines.push("  dry-run: no export");
  }
  return `${lines.join("\n")}\n`;
}
