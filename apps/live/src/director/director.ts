import type { CommentSourceKind, DirectorOutput, LiveLlmMode } from "@kakeai/contracts";
import { isLocalLlmEndpoint } from "../llm/local-endpoint.ts";
import {
  createOpenAiCompatibleClient,
  LiveLlmTimeoutError,
  type LlmClient,
} from "../llm/openai-client.ts";
import { DirectorGenerationError } from "./errors.ts";
import { buildDirectorPrompt, type DirectorContext, type DirectorPrompt } from "./prompt.ts";
import {
  directorSafetyPolicyFromContext,
  validateDirectorOutput,
} from "./safety.ts";

export { DirectorGenerationError } from "./errors.ts";
export type { DirectorGenerationFailureReason } from "./errors.ts";

export class DirectorSafetyError extends Error {
  constructor(message = "実 YouTube の応答生成にはローカル LLM だけを使えます。") {
    super(message);
    this.name = "DirectorSafetyError";
  }
}

export interface DirectorLlmConfig {
  mode: LiveLlmMode;
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs?: number;
}

export interface GenerateDirectorOutputOptions {
  llm: DirectorLlmConfig;
  context: DirectorContext;
  fetch?: typeof fetch;
}

export interface CreateDirectorOptions {
  llm: DirectorLlmConfig;
  sourceKind: CommentSourceKind;
  fetch?: typeof fetch;
}

export interface Director {
  readonly sourceKind: CommentSourceKind;
  generate(context: DirectorContext): Promise<DirectorOutput>;
}

const DEFAULT_TIMEOUT_MS = 15_000;

function resolveTimeoutMs(llm: DirectorLlmConfig): number {
  const raw = llm.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return Number.isFinite(raw) && raw > 0 ? Math.max(1, Math.floor(raw)) : DEFAULT_TIMEOUT_MS;
}

function parseJsonObject(raw: string): unknown | null {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    // Local models occasionally wrap JSON in prose or code fences.
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new DirectorGenerationError("timeout", "ディレクターの生成がタイムアウトしました。"));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function createClient(
  llm: DirectorLlmConfig,
  timeoutMs: number,
  fetchImpl: typeof fetch | undefined,
): LlmClient {
  return createOpenAiCompatibleClient({
    baseUrl: llm.baseUrl,
    model: llm.model,
    timeoutMs,
    ...(llm.apiKey === undefined ? {} : { apiKey: llm.apiKey }),
    ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
  });
}

async function completeOnce(
  client: LlmClient,
  prompt: DirectorPrompt,
  timeoutMs: number,
): Promise<unknown> {
  let raw: string;
  try {
    raw = await withTimeout(client.completeJson(prompt), timeoutMs);
  } catch (error) {
    if (error instanceof DirectorGenerationError) {
      throw error;
    }
    if (error instanceof LiveLlmTimeoutError) {
      throw new DirectorGenerationError(
        "timeout",
        "ディレクターの生成がタイムアウトしました。",
        { cause: error },
      );
    }
    throw new DirectorGenerationError("llm", "ディレクターの LLM 呼び出しに失敗しました。", {
      cause: error,
    });
  }
  const parsed = parseJsonObject(raw);
  if (parsed === null) {
    throw new DirectorGenerationError("invalid", "ディレクターの応答が JSON ではありません。");
  }
  return parsed;
}

/**
 * Generates one comment response. Schema and safety violations are retried
 * once; timeouts and LLM transport errors fail immediately. Raw comment text
 * never enters this function: only the structured `DirectorContext`.
 */
export async function generateDirectorOutput(
  options: GenerateDirectorOutputOptions,
): Promise<DirectorOutput> {
  const timeoutMs = resolveTimeoutMs(options.llm);
  const client = createClient(options.llm, timeoutMs, options.fetch);
  const prompt = buildDirectorPrompt(options.context);
  const policy = directorSafetyPolicyFromContext(options.context);

  let lastError: DirectorGenerationError | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const parsed = await completeOnce(client, prompt, timeoutMs);
      const validated = validateDirectorOutput(parsed, policy);
      if (validated.ok) {
        return validated.output;
      }
      lastError = new DirectorGenerationError(validated.reason, validated.message);
    } catch (error) {
      if (error instanceof DirectorGenerationError && error.reason !== "invalid") {
        throw error;
      }
      lastError =
        error instanceof DirectorGenerationError
          ? error
          : new DirectorGenerationError("llm", "ディレクターの生成に失敗しました。", {
              cause: error,
            });
    }
  }
  throw lastError ?? new DirectorGenerationError("invalid", "ディレクターの生成に失敗しました。");
}

/**
 * Factory gate for the live wiring. A real YouTube source may only use a
 * loopback LLM, matching the analyst and the data policy in ADR-0123.
 */
export function createDirector(options: CreateDirectorOptions): Director {
  if (options.sourceKind === "youtube" && !isLocalLlmEndpoint(options.llm)) {
    throw new DirectorSafetyError();
  }
  return {
    sourceKind: options.sourceKind,
    generate: (context) =>
      generateDirectorOutput({
        llm: options.llm,
        context,
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      }),
  };
}

export interface GeneratedCueLogData {
  commentId: string | null;
  cueCount: number;
  skip: boolean;
  reason: string;
  cues: Array<{
    speaker: string;
    caption: string;
    speech: string;
    expression: string;
  }>;
}

/** Structured payload for `cue_generated`; no raw comment or author text. */
export function generatedCueLogData(
  output: DirectorOutput,
  input: { commentId: string | null; reason: string },
): GeneratedCueLogData {
  return {
    commentId: input.commentId,
    cueCount: output.cues.length,
    skip: output.skip,
    reason: input.reason,
    cues: output.cues.map((cue) => ({
      speaker: cue.speaker,
      caption: cue.caption,
      speech: cue.speech,
      expression: cue.expression,
    })),
  };
}
