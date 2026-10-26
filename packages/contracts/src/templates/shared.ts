import type { z } from "zod";
import type { CueLayer, TransitionPolicy } from "../content/layers";
import type { AnimationPolicy } from "../content/animation";
import type { AssetKindName, AssetReference } from "../content/asset-reference";
import type { LineReference } from "../content/cue-effect";
import type { RichTextMark } from "../content/rich-text";

export interface TemplateDisplay {
  label: string;
  description: string;
  category: string;
}

export type TemplateFieldSpec =
  | { kind: "media"; key: string; label: string; assetKinds: readonly AssetKindName[]; videoPlayback?: boolean }
  | { kind: "nestedMedia"; key: string; label: string; assetKinds: readonly AssetKindName[]; optional?: boolean; allowComposition?: boolean; videoPlayback?: boolean }
  | { kind: "text"; key: string; label: string }
  | { kind: "optionalText"; key: string; label: string }
  | {
      kind: "richText";
      key: string;
      label: string;
      marks: readonly [RichTextMark, ...RichTextMark[]];
      optional?: boolean;
    }
  | { kind: "select"; key: string; label: string; options: readonly { value: string; label: string }[]; optional?: boolean }
  | { kind: "color"; key: string; label: string; optional?: boolean }
  | { kind: "number"; key: string; label: string; min?: number; max?: number; step?: number; optional?: boolean }
  | { kind: "decimal"; key: string; label: string; min?: number; max?: number; optional?: boolean; defaultValue?: number }
  | { kind: "mediaCrop"; key: string; label: string; zoomKey?: string }
  | { kind: "boolean"; key: string; label: string }
  | { kind: "grid"; key: string; label: string; maxColumns: number; maxRows: number; dataKind: "table" | "chart" }
  | { kind: "flow"; key: string; label: string; maxNodes: number; maxEdges: number }
  | { kind: "effects"; key: string; label: string; variant: "table" | "chart" | "flow" | "stat" | "quote" | "chat" }
  | { kind: "calloutItems"; key: string; label: string }
  | { kind: "messages"; key: string; label: string; maxMessages: number }
  | { kind: "animation"; key: string; label: string };

export interface VisualTemplateDefinition {
  id: string;
  version: number;
  inputSchema: z.ZodTypeAny;
  layers: readonly CueLayer[];
  transitionPolicy: TransitionPolicy;
  animationPolicy: AnimationPolicy;
  display: TemplateDisplay;
  inputFields?: readonly TemplateFieldSpec[];
  /**
   * A complete input that passes `inputSchema`. It is published by the Agent
   * surface (`template.get`) so an agent can start from a valid shape instead
   * of guessing nested JSON. The schema stays the only validation source; a
   * test ensures this example keeps parsing against `inputSchema`.
   */
  exampleInput: unknown;
  collectAssetRefs: (input: unknown, path: (string | number)[], depth?: number) => AssetReference[];
  collectLineRefs?: (input: unknown, path: (string | number)[]) => LineReference[];
}
