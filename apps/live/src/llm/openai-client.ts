export class LiveLlmError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LiveLlmError";
  }
}

export class LiveLlmHttpError extends LiveLlmError {
  constructor(
    readonly status: number,
    message = `LLM が HTTP ${status} を返しました。`,
  ) {
    super(message);
    this.name = "LiveLlmHttpError";
  }
}

export class LiveLlmTimeoutError extends LiveLlmError {
  constructor(message = "LLM がタイムアウトしました。") {
    super(message);
    this.name = "LiveLlmTimeoutError";
  }
}

export class LiveLlmResponseError extends LiveLlmError {
  constructor(message = "LLM の応答形式が不正です。", options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LiveLlmResponseError";
  }
}

export interface LiveLlmPrompt {
  system: string;
  user: string;
}

export interface LlmClient {
  completeJson(prompt: LiveLlmPrompt): Promise<string>;
}

export interface OpenAiCompatibleClientOptions {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

const DEFAULT_LLM_TIMEOUT_MS = 15_000;

function isTimeoutError(error: unknown): boolean {
  return (
    (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) ||
    (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError"))
  );
}

function chatCompletionsEndpoint(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    const base = url.pathname.replace(/\/+$/u, "");
    url.pathname = base.endsWith("/chat/completions")
      ? base
      : `${base}/chat/completions`;
    return url.toString();
  } catch {
    throw new LiveLlmError("LLM の baseUrl が不正です。");
  }
}

function readContent(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) {
    throw new LiveLlmResponseError();
  }
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new LiveLlmResponseError();
  }
  const message = (choices[0] as { message?: unknown } | undefined)?.message;
  const content = (message as { content?: unknown } | undefined)?.content;
  if (typeof content === "string" && content.trim().length > 0) {
    return content;
  }
  // Some OpenAI-compatible servers return the content-part array shape even
  // for text-only responses.
  if (Array.isArray(content)) {
    const text = content
      .map((part) =>
        typeof part === "object" &&
        part !== null &&
        typeof (part as { text?: unknown }).text === "string"
          ? (part as { text: string }).text
          : "",
      )
      .join("");
    if (text.trim().length > 0) {
      return text;
    }
  }
  throw new LiveLlmResponseError();
}

/**
 * Thin OpenAI-compatible `/chat/completions` client. Prompts and responses are
 * never logged here: live YouTube comments must stay on the local machine.
 */
export function createOpenAiCompatibleClient(
  options: OpenAiCompatibleClientOptions,
): LlmClient {
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS;
  const endpoint = chatCompletionsEndpoint(options.baseUrl);

  return {
    async completeJson(prompt: LiveLlmPrompt): Promise<string> {
      let response: Response;
      try {
        response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(options.apiKey === undefined
              ? {}
              : { Authorization: `Bearer ${options.apiKey}` }),
          },
          body: JSON.stringify({
            model: options.model,
            messages: [
              { role: "system", content: prompt.system },
              { role: "user", content: prompt.user },
            ],
            temperature: 0,
            stream: false,
          }),
          redirect: "error",
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        if (isTimeoutError(error)) {
          throw new LiveLlmTimeoutError();
        }
        throw new LiveLlmError("LLM に接続できません。", { cause: error });
      }

      if (!response.ok) {
        throw new LiveLlmHttpError(response.status);
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch (error) {
        throw new LiveLlmResponseError("LLM の応答を JSON として読めません。", { cause: error });
      }
      return readContent(payload);
    },
  };
}
