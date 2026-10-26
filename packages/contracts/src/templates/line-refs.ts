import type { z } from "zod";
import { lineTriggerSchema } from "../content/cue-effect";
import type { LineReference } from "../content/cue-effect";
import type { VisualTemplateDefinition } from "./shared";

export function collectTriggerLineRefs(
  trigger: unknown,
  path: (string | number)[],
): LineReference[] {
  const parsed = lineTriggerSchema.safeParse(trigger);
  if (!parsed.success || parsed.data.kind !== "lines") {
    return [];
  }
  return [
    { lineId: parsed.data.startLineId, path: [...path, "startLineId"] },
    { lineId: parsed.data.endLineId, path: [...path, "endLineId"] },
  ];
}

export function readInputField(input: unknown, key: string): unknown {
  if (typeof input !== "object" || input === null) {
    return undefined;
  }
  return (input as Record<string, unknown>)[key];
}

/**
 * Builds the common `collectLineRefs` implementation for templates whose
 * `effects` array carries line triggers. Each entry's trigger is validated
 * independently, so an invalid draft entry does not hide the references of its
 * valid siblings.
 */
export function createEffectsLineRefCollector(): NonNullable<
  VisualTemplateDefinition["collectLineRefs"]
> {
  return (input, path) => {
    const entries = readInputField(input, "effects");
    if (!Array.isArray(entries)) {
      return [];
    }
    return entries.flatMap((entry, index) =>
      collectTriggerLineRefs(readInputField(entry, "trigger"), [
        ...path,
        "effects",
        index,
        "trigger",
      ]),
    );
  };
}
