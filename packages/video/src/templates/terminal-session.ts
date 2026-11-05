import {
  TERMINAL_DEFAULT_CHARS_PER_SECOND,
  TERMINAL_DEFAULT_ENTER_DELAY_MS,
  terminalSessionInputSchema,
  textWidthUnits,
  type TerminalEffect,
  type TerminalRevealMode,
} from "@kakeai/contracts";
import { CompositionCompileError } from "../compile-error";
import { resolveTriggerWindow } from "../cue-effects";
import { escapeHtmlText } from "../escape";
import type { RenderContext, RenderedCue, StateInterval } from "../render-context";
import { contrastRatio, mixHex } from "../theme";

const TERMINAL_BODY_HEX = "#08080A";
const TRAFFIC_LIGHT_COLORS = ["#FF5F57", "#FEBC2E", "#28C840"] as const;

interface RevealPlan {
  mode: TerminalRevealMode;
  startMs: number;
  /** Time at which the last input character is visible. */
  typingDoneMs: number;
  /** Time at which the output block becomes visible. */
  outputAtMs: number;
  chars: string[];
  widths: number[];
  /** Absolute reveal time of each character, relative to the cue start. */
  revealTimes: number[];
  /** First character that is revealed together at `typingDoneMs`. */
  popIndex: number;
}

interface TerminalTurnMarkup {
  index: number;
  turnHtml: string;
}

function promptColor(accent: string): string {
  return contrastRatio(accent, TERMINAL_BODY_HEX) >= 3
    ? accent
    : mixHex(accent, "#FFFFFF", 0.55);
}

function planReveal(options: {
  effect: TerminalEffect;
  input: string;
  lineIntervals: RenderContext["lineIntervals"];
  spanMs: number;
  charsPerSecond: number;
  enterDelayMs: number;
  path: (string | number)[];
}): RevealPlan | null {
  const window = resolveTriggerWindow(
    options.effect.trigger,
    options.lineIntervals ?? [],
    options.spanMs,
    options.path,
  );
  if (window === null) {
    return null;
  }
  const mode = options.effect.effect.mode ?? "type";
  const chars = [...options.input];
  if (mode === "instant") {
    return {
      mode,
      startMs: window.startMs,
      typingDoneMs: window.startMs,
      outputAtMs: window.startMs,
      chars,
      widths: chars.map((char) => textWidthUnits(char)),
      revealTimes: chars.map(() => window.startMs),
      popIndex: chars.length,
    };
  }

  const widths = chars.map((char) => textWidthUnits(char));
  const revealTimes = chars.map(() => window.startMs);
  let typedUnits = 0;
  for (let index = 1; index < chars.length; index += 1) {
    typedUnits += widths[index - 1] ?? 0;
    revealTimes[index] = window.startMs + Math.round((typedUnits / options.charsPerSecond) * 1000);
  }
  const lastRevealMs = revealTimes[chars.length - 1] ?? window.startMs;
  const budgetEndMs =
    options.effect.trigger.kind === "lines" ? window.endMs : options.spanMs;
  // Reserve the Enter pause inside the typing budget so the output still
  // appears by the end of the narration window.
  const typingBudgetEndMs = Math.max(
    window.startMs,
    budgetEndMs - options.enterDelayMs,
  );
  const typingDoneMs = Math.max(
    window.startMs,
    Math.min(lastRevealMs, typingBudgetEndMs, options.spanMs),
  );
  const outputAtMs = Math.min(
    typingDoneMs + options.enterDelayMs,
    budgetEndMs,
    options.spanMs > 0 ? options.spanMs : typingDoneMs + options.enterDelayMs,
  );
  const popIndex = chars.findIndex(
    (_char, index) => (widths[index] ?? 0) > 0 && revealTimes[index]! > typingDoneMs,
  );

  return {
    mode,
    startMs: window.startMs,
    typingDoneMs,
    outputAtMs,
    chars,
    widths,
    revealTimes,
    popIndex: popIndex < 0 ? chars.length : popIndex,
  };
}

function caretEventsFor(plan: RevealPlan, outputAtMs: number): { timeMs: number; charIndex: number }[] {
  if (plan.mode !== "type" || plan.chars.length === 0) {
    return [];
  }
  const events: { timeMs: number; charIndex: number }[] = [];
  const push = (timeMs: number, charIndex: number): void => {
    if (timeMs >= outputAtMs) {
      return;
    }
    const previous = events[events.length - 1];
    if (previous !== undefined && previous.timeMs === timeMs) {
      previous.charIndex = charIndex;
      return;
    }
    events.push({ timeMs, charIndex });
  };
  for (let index = 0; index < plan.popIndex; index += 1) {
    if ((plan.widths[index] ?? 0) === 0) {
      continue;
    }
    push(plan.revealTimes[index]!, index);
  }
  if (plan.popIndex < plan.chars.length) {
    push(plan.typingDoneMs, plan.chars.length - 1);
  }
  return events;
}

function charHtml(options: {
  turnIndex: number;
  charIndex: number;
  char: string;
  hidden: boolean;
  scope: RenderContext["scope"];
}): string {
  const charId = options.scope.id(`char-${options.turnIndex}-${options.charIndex}`);
  const caretId = options.scope.id(`caret-${options.turnIndex}-${options.charIndex}`);
  const style = options.hidden ? ' style="opacity:0"' : "";
  return `<span id="${charId}" class="kakeai-terminalchar"${style}>${escapeHtmlText(options.char)}<span id="${caretId}" class="kakeai-terminalcaret" aria-hidden="true"></span></span>`;
}

function inputHtml(options: {
  turnIndex: number;
  input: string;
  plan: RevealPlan | null;
  scope: RenderContext["scope"];
}): string {
  const { input, plan, turnIndex, scope } = options;
  const chars = [...input];
  if (plan === null || plan.mode === "instant") {
    return chars.map((char, charIndex) => charHtml({ turnIndex, charIndex, char, hidden: false, scope })).join("");
  }
  const head = chars
    .slice(0, plan.popIndex)
    .map((char, charIndex) =>
      charHtml({
        turnIndex,
        charIndex,
        char,
        hidden: (plan.widths[charIndex] ?? 0) > 0 && plan.revealTimes[charIndex]! > plan.startMs,
        scope,
      }),
    )
    .join("");
  const tail = chars
    .slice(plan.popIndex)
    .map((char, offset) => {
      const charIndex = plan.popIndex + offset;
      return charHtml({ turnIndex, charIndex, char, hidden: false, scope });
    })
    .join("");
  if (tail.length === 0) {
    return head;
  }
  const tailId = scope.id(`tail-${turnIndex}`);
  const hidden = plan.typingDoneMs > plan.startMs;
  return `${head}<span id="${tailId}" class="kakeai-terminaltail"${hidden ? ' style="opacity:0"' : ""}>${tail}</span>`;
}

function outputHtml(options: {
  turnIndex: number;
  output: readonly string[] | undefined;
  hidden: boolean;
  scope: RenderContext["scope"];
}): string {
  const output = options.output ?? [];
  if (output.length === 0) {
    return "";
  }
  const outputId = options.scope.id(`out-${options.turnIndex}`);
  const rows = output
    .map(
      (line) =>
        `<div class="kakeai-terminalrow kakeai-terminal-outputrow">${line.length > 0 ? escapeHtmlText(line) : "&nbsp;"}</div>`,
    )
    .join("");
  return `<div id="${outputId}" class="kakeai-terminaloutput"${options.hidden ? ' style="display:none"' : ""}>${rows}</div>`;
}

export function renderTerminalSession(input: unknown, context: RenderContext): RenderedCue {
  const parsed = terminalSessionInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new CompositionCompileError([
      { path: context.path, code: "invalid_input", message: "terminal.session の入力が不正です。" },
    ]);
  }
  const { title, prompt, typing, turns, effects } = parsed.data;
  const charsPerSecond =
    typing?.charsPerSecond ?? TERMINAL_DEFAULT_CHARS_PER_SECOND;
  const enterDelayMs = typing?.enterDelayMs ?? TERMINAL_DEFAULT_ENTER_DELAY_MS;
  const spanMs = context.cueTiming?.spanMs ?? 0;
  const lineIntervals = context.lineIntervals ?? [];
  const promptText = prompt;
  const promptHex = promptColor(context.theme.accents.primary);
  const stateIntervals: StateInterval[] = [];
  const plans: (RevealPlan | null)[] = turns.map(() => null);

  (effects ?? []).forEach((effect, effectIndex) => {
    const turn = turns[effect.target.index];
    if (turn === undefined) {
      return;
    }
    // The input schema rejects duplicate turn targets, so each slot is assigned once.
    plans[effect.target.index] = planReveal({
      effect,
      input: turn.input,
      lineIntervals,
      spanMs,
      charsPerSecond,
      enterDelayMs,
      path: [...context.path, "effects", effectIndex],
    });
  });

  const turnMarkups: TerminalTurnMarkup[] = turns.map((turn, turnIndex) => {
    const plan = plans[turnIndex];
    const turnId = context.scope.id(`turn-${turnIndex}`);
    const promptHtml =
      promptText.length === 0
        ? ""
        : `<span class="kakeai-terminalprompt" style="color:${promptHex}">${escapeHtmlText(promptText)}</span> `;
    const input = inputHtml({ turnIndex, input: turn.input, plan, scope: context.scope });
    const outputHidden =
      plan !== null &&
      plan.mode === "type" &&
      plan.outputAtMs > 0 &&
      (turn.output?.length ?? 0) > 0;
    const output = outputHtml({
      turnIndex,
      output: turn.output,
      hidden: outputHidden,
      scope: context.scope,
    });
    const caretEvents =
      plan === null ? [] : caretEventsFor(plan, plan.outputAtMs);

    if (plan !== null && plan.startMs > 0) {
      stateIntervals.push({
        targetId: turnId,
        intervals: [{ startMs: 0, endMs: plan.startMs }],
        on: { display: "none" },
        off: { display: "block" },
      });
    }

    if (plan !== null && plan.mode === "type") {
      for (let charIndex = 0; charIndex < plan.popIndex; charIndex += 1) {
        const revealAt = plan.revealTimes[charIndex]!;
        if ((plan.widths[charIndex] ?? 0) === 0 || revealAt <= plan.startMs) {
          continue;
        }
        stateIntervals.push({
          targetId: context.scope.id(`char-${turnIndex}-${charIndex}`),
          intervals: [{ startMs: plan.startMs, endMs: revealAt }],
          on: { opacity: 0 },
          off: { opacity: 1 },
        });
      }
      if (plan.popIndex < plan.chars.length && plan.typingDoneMs > plan.startMs) {
        stateIntervals.push({
          targetId: context.scope.id(`tail-${turnIndex}`),
          intervals: [{ startMs: plan.startMs, endMs: plan.typingDoneMs }],
          on: { opacity: 0 },
          off: { opacity: 1 },
        });
      }
      if (outputHidden) {
        stateIntervals.push({
          targetId: context.scope.id(`out-${turnIndex}`),
          intervals: [{ startMs: 0, endMs: plan.outputAtMs }],
          on: { display: "none" },
          off: { display: "block" },
        });
      }
      caretEvents.forEach((event, eventIndex) => {
        const next = caretEvents[eventIndex + 1]?.timeMs ?? plan.outputAtMs;
        if (next <= event.timeMs) {
          return;
        }
        stateIntervals.push({
          targetId: context.scope.id(`caret-${turnIndex}-${event.charIndex}`),
          intervals: [{ startMs: event.timeMs, endMs: next }],
          on: { opacity: 1 },
          off: { opacity: 0 },
        });
      });
    }

    return {
      index: turnIndex,
      turnHtml: `<div id="${turnId}" class="kakeai-terminalturn"><div class="kakeai-terminalrow kakeai-terminal-inputrow">${promptHtml}<span class="kakeai-terminalinput">${input}</span></div>${output}</div>`,
    };
  });

  const titleHtml =
    title !== undefined && title.trim().length > 0
      ? `<span class="kakeai-terminaltitle">${escapeHtmlText(title)}</span>`
      : "";
  const dotsHtml = TRAFFIC_LIGHT_COLORS.map(
    (color) =>
      `<span class="kakeai-terminaldot" style="background:${color}" aria-hidden="true"></span>`,
  ).join("");
  const windowHtml = `<div class="kakeai-terminalwindow"><div class="kakeai-terminalbar"><span class="kakeai-terminaldots">${dotsHtml}</span>${titleHtml}</div><div class="kakeai-terminalbody"><div class="kakeai-terminallines">${turnMarkups
    .map((markup) => markup.turnHtml)
    .join("")}</div></div></div>`;

  return {
    html: `<div class="kakeai-terminalwrap" style="--kakeai-terminal-prompt:${promptHex}">${windowHtml}</div>`,
    assetIds: [],
    animation: [],
    stateIntervals,
  };
}
