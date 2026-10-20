import type { TableTone, VisualThemeDefinition } from "@kakeai/contracts";
import { CompositionCompileError } from "../compile-error";

export function toneHex(tone: TableTone, theme: VisualThemeDefinition): string {
  switch (tone) {
    case "primary":
      return theme.accents.primary;
    case "secondary":
      return theme.accents.secondary;
    case "tertiary":
      return theme.accents.tertiary;
    case "success":
      return theme.semantic.success;
    case "warning":
      return theme.semantic.warning;
    case "error":
      return theme.semantic.error;
    case "info":
      return theme.semantic.info;
    default: {
      const exhaustive: never = tone;
      throw new CompositionCompileError([
        { path: [], code: "unknown_tone", message: `未対応の強調色です: ${String(exhaustive)}` },
      ]);
    }
  }
}
