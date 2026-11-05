import { z } from "zod";
import { DEFAULT_ANIMATION_POLICY } from "../content/animation";
import { lineTriggerSchema } from "../content/cue-effect";
import { DEFAULT_TRANSITION_POLICY } from "../content/layers";
import { nonNegativeInt } from "../content/primitives";
import { createEffectsLineRefCollector } from "./line-refs";
import type { VisualTemplateDefinition } from "./shared";

export const TERMINAL_MAX_TURNS = 12;
export const TERMINAL_MAX_OUTPUT_LINES = 32;
export const TERMINAL_MAX_EFFECTS = 32;
export const TERMINAL_DEFAULT_PROMPT = "$";
export const TERMINAL_DEFAULT_CHARS_PER_SECOND = 40;
export const TERMINAL_DEFAULT_ENTER_DELAY_MS = 120;

/**
 * Row / character guidelines used by `computeContentWarnings`. The rendered
 * layout is container-relative, so these are deliberately conservative
 * estimates for the floating window on each output profile.
 */
export const TERMINAL_ROWS_GUIDELINE = {
  landscape: 13,
  portrait: 32,
} as const;
export const TERMINAL_CHARS_PER_LINE_GUIDELINE = 44;

export const terminalRevealModeSchema = z.enum(["type", "instant"]);
export type TerminalRevealMode = z.infer<typeof terminalRevealModeSchema>;

export const terminalRevealEffectSchema = z.strictObject({
  kind: z.literal("reveal"),
  /** Defaults to "type" when omitted. */
  mode: terminalRevealModeSchema.optional(),
});
export type TerminalRevealEffect = z.infer<typeof terminalRevealEffectSchema>;

export const terminalEffectTargetSchema = z.strictObject({
  kind: z.literal("turn"),
  index: nonNegativeInt,
});
export type TerminalEffectTarget = z.infer<typeof terminalEffectTargetSchema>;

export const terminalEffectSchema = z.strictObject({
  target: terminalEffectTargetSchema,
  trigger: lineTriggerSchema,
  effect: terminalRevealEffectSchema,
});
export type TerminalEffect = z.infer<typeof terminalEffectSchema>;

export const terminalEffectsSchema = z.array(terminalEffectSchema).max(TERMINAL_MAX_EFFECTS);

export const terminalTypingSchema = z.strictObject({
  charsPerSecond: z.number().finite().min(1).max(120).optional(),
  enterDelayMs: nonNegativeInt.max(2000).optional(),
});
export type TerminalTyping = z.infer<typeof terminalTypingSchema>;

const singleLineText = (label: string, max: number, min = 0) =>
  z
    .string()
    .min(min)
    .max(max)
    .refine((value) => !/[\r\n]/.test(value), {
      message: `${label}は1行で入力してください。`,
    });

export const terminalTurnSchema = z.strictObject({
  input: singleLineText("入力", 400, 1),
  output: z.array(singleLineText("出力", 400)).max(TERMINAL_MAX_OUTPUT_LINES).optional(),
});
export type TerminalTurn = z.infer<typeof terminalTurnSchema>;

export const terminalTurnsSchema = z
  .array(terminalTurnSchema)
  .min(1)
  .max(TERMINAL_MAX_TURNS);

export const terminalSessionInputSchema = z
  .strictObject({
    title: singleLineText("タイトル", 120).optional(),
    prompt: singleLineText("プロンプト", 24).default(TERMINAL_DEFAULT_PROMPT),
    typing: terminalTypingSchema.optional(),
    turns: terminalTurnsSchema,
    effects: terminalEffectsSchema.optional(),
  })
  .superRefine((input, ctx) => {
    const seenTurns = new Set<number>();
    (input.effects ?? []).forEach((entry, index) => {
      if (entry.target.index >= input.turns.length) {
        ctx.addIssue({
          code: "custom",
          message: `効果のターン番号が件数を超えています: ${entry.target.index}`,
          path: ["effects", index, "target", "index"],
        });
      }
      if (
        entry.trigger.kind === "lines" &&
        entry.trigger.startLineId !== entry.trigger.endLineId
      ) {
        ctx.addIssue({
          code: "custom",
          message: "端末の表示効果は1つのセリフを指定してください。",
          path: ["effects", index, "trigger", "endLineId"],
        });
      }
      if (seenTurns.has(entry.target.index)) {
        ctx.addIssue({
          code: "custom",
          message: "同じターンに複数の表示効果は指定できません。",
          path: ["effects", index, "target", "index"],
        });
      }
      seenTurns.add(entry.target.index);
    });
  });
export type TerminalSessionInput = z.infer<typeof terminalSessionInputSchema>;

export const terminalSessionV1: VisualTemplateDefinition = {
  id: "terminal.session",
  version: 1,
  inputSchema: terminalSessionInputSchema,
  layers: ["card"],
  transitionPolicy: DEFAULT_TRANSITION_POLICY,
  animationPolicy: DEFAULT_ANIMATION_POLICY,
  display: {
    label: "ターミナル",
    description: "黒いターミナル画面に入力と出力を並べる",
    category: "text",
  },
  inputFields: [
    { kind: "optionalText", key: "title", label: "ウインドウのタイトル" },
    { kind: "optionalText", key: "prompt", label: "プロンプト" },
    {
      kind: "number",
      key: "typing.charsPerSecond",
      label: "入力速度（半角換算/秒）",
      min: 1,
      max: 120,
      step: 1,
      optional: true,
    },
    {
      kind: "number",
      key: "typing.enterDelayMs",
      label: "出力までの間隔(ms)",
      min: 0,
      max: 2000,
      step: 10,
      optional: true,
    },
    { kind: "turns", key: "turns", label: "入力と出力", maxTurns: TERMINAL_MAX_TURNS },
    { kind: "effects", key: "effects", label: "セリフ同期", variant: "terminal" },
  ],
  exampleInput: {
    title: "~/project — zsh",
    prompt: "$",
    typing: { charsPerSecond: 40 },
    turns: [
      {
        input: "npm test",
        output: ["PASS src/example.test.ts", "Tests 12 passed"],
      },
      {
        input: "git status",
        output: ["On branch main", "nothing to commit, working tree clean"],
      },
    ],
    effects: [
      {
        target: { kind: "turn", index: 0 },
        trigger: {
          kind: "lines",
          startLineId: "<lineId>",
          endLineId: "<lineId>",
        },
        effect: { kind: "reveal", mode: "type" },
      },
    ],
  } satisfies z.input<typeof terminalSessionInputSchema>,
  collectAssetRefs: () => [],
  collectLineRefs: createEffectsLineRefCollector(),
};
