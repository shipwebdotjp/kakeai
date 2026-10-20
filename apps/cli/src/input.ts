import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { AGENT_MAX_REQUEST_BYTES } from "@kakeai/contracts";
import { inputError } from "./errors.ts";

export interface CliInputSourceOptions {
  cwd: string;
  readStdin: () => Promise<string>;
}

export async function readStdinText(): Promise<string> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of process.stdin as AsyncIterable<Buffer | string>) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    totalBytes += buffer.byteLength;
    if (totalBytes > AGENT_MAX_REQUEST_BYTES) {
      throw inputError(
        "input_too_large",
        `--input (stdin) が 1 要求の上限（${AGENT_MAX_REQUEST_BYTES} バイト）を超えています。`,
      );
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseJsonText(text: string, source: string): unknown {
  const normalized = text.replace(/^\uFEFF/u, "");
  if (normalized.trim().length === 0) {
    throw inputError("empty_input", `${source} が空です。JSON を指定してください。`);
  }
  if (Buffer.byteLength(normalized, "utf8") > AGENT_MAX_REQUEST_BYTES) {
    throw inputError(
      "input_too_large",
      `${source} が 1 要求の上限（${AGENT_MAX_REQUEST_BYTES} バイト）を超えています。`,
    );
  }
  try {
    return JSON.parse(normalized);
  } catch {
    throw inputError("invalid_json", `${source} を JSON として解析できません。`);
  }
}

/** Inline JSON is recognised by its first non-space character. */
function looksLikeInlineJson(value: string): boolean {
  const first = value.trimStart().charAt(0);
  return first === "{" || first === "[";
}

/**
 * Resolves `--input`: an inline JSON document, `-` for stdin, or a file path.
 * No JSON is interpreted or repaired here; callers validate with the contract
 * schema before anything is sent over the socket.
 */
export async function readCliInput(
  source: string | undefined,
  options: CliInputSourceOptions,
): Promise<unknown> {
  if (source === undefined) {
    return {};
  }
  if (source === "-") {
    return parseJsonText(await options.readStdin(), "--input (stdin)");
  }
  if (looksLikeInlineJson(source)) {
    return parseJsonText(source, "--input");
  }
  const path = isAbsolute(source) ? source : resolve(options.cwd, source);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    throw inputError("read_failed", `--input のファイルを読み取れません: ${path}`);
  }
  return parseJsonText(text, path);
}
