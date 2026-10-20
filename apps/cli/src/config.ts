import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  MAX_JOB_WAIT_INTERVAL_MS,
  MAX_JOB_WAIT_TIMEOUT_MS,
  MIN_JOB_WAIT_INTERVAL_MS,
} from "@kakeai/agent-client";
import { usageError } from "./errors.ts";
import { resolveCliCommand, type CliCommand } from "./commands.ts";

export const DEFAULT_AGENT_ID = "cli";

/** Node clamps timer delays above this value to 1 ms. */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

export interface CliRunOptions {
  input?: string;
  pretty: boolean;
  wait: boolean;
  agentId: string;
  dataRoot?: string;
  socketPath?: string;
  /** Per-request timeout, applied to both reads and mutations. */
  timeoutMs?: number;
  /** Total budget for `job.wait` / `--wait`. */
  waitTimeoutMs?: number;
  waitIntervalMs?: number;
  /** `job.wait <jobId>` positional. Overrides the `jobId` inside `--input`. */
  jobId?: string;
}

export type ParsedCliArgs =
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "operations"; pretty: boolean }
  | CliRunArgs;

export interface CliRunArgs {
  kind: "run";
  command: CliCommand;
  options: CliRunOptions;
}

const CLI_OPTIONS = {
  input: { type: "string" },
  pretty: { type: "boolean" },
  wait: { type: "boolean" },
  "agent-id": { type: "string" },
  "data-dir": { type: "string" },
  socket: { type: "string" },
  timeout: { type: "string" },
  "timeout-ms": { type: "string" },
  "interval-ms": { type: "string" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "V" },
} as const;

export function readPackageVersion(): string {
  try {
    const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "version" in parsed &&
      typeof parsed.version === "string" &&
      parsed.version.length > 0
    ) {
      return parsed.version;
    }
  } catch {
    // A missing package metadata file must not break the CLI.
  }
  return "0.0.0";
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

function integerOption(
  flag: string,
  raw: string | undefined,
  min: number,
  max?: number,
): number | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const trimmed = raw.trim();
  const range =
    max === undefined ? `${min} 以上` : `${min} 以上 ${max} 以下`;
  if (!/^\d+$/u.test(trimmed)) {
    throw usageError(`${flag} には ${range}の整数を指定してください。`);
  }
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value < min || (max !== undefined && value > max)) {
    throw usageError(`${flag} には ${range}の整数を指定してください。`);
  }
  return value;
}

/**
 * `--flag value` and `--flag=value` are both accepted. Explicit arguments win
 * over environment variables, and `--socket` wins over `--data-dir`.
 */
export function parseCliArgs(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): ParsedCliArgs {
  let positionals: string[];
  let values: {
    input?: string;
    pretty?: boolean;
    wait?: boolean;
    "agent-id"?: string;
    "data-dir"?: string;
    socket?: string;
    timeout?: string;
    "timeout-ms"?: string;
    "interval-ms"?: string;
    help?: boolean;
    version?: boolean;
  };

  try {
    const parsed = parseArgs({
      args: [...argv],
      options: CLI_OPTIONS,
      allowPositionals: true,
      strict: true,
    });
    positionals = parsed.positionals;
    values = parsed.values;
  } catch (error) {
    throw usageError(error instanceof Error ? error.message : "引数が不正です。");
  }

  if (values.help === true) {
    return { kind: "help" };
  }
  if (values.version === true) {
    return { kind: "version" };
  }

  const commandName = positionals[0];
  if (commandName === undefined) {
    return { kind: "help" };
  }
  if (commandName === "operations") {
    if (positionals.length > 1) {
      throw usageError("operations は追加の引数を受け取りません。");
    }
    return { kind: "operations", pretty: values.pretty === true };
  }

  const command = resolveCliCommand(commandName);
  if (command === undefined) {
    throw usageError(`未知のサブコマンドです: ${commandName}`);
  }

  const rest = positionals.slice(1);
  const maxPositionals = command.kind === "jobWait" ? 1 : 0;
  if (rest.length > maxPositionals) {
    throw usageError(`${commandName} に余分な引数があります: ${rest.slice(maxPositionals).join(" ")}`);
  }
  const jobId = command.kind === "jobWait" ? nonEmpty(rest[0]) : undefined;
  if (command.kind === "jobWait" && rest[0] !== undefined && jobId === undefined) {
    throw usageError("job.wait の jobId には空でない値を指定してください。");
  }

  const wait = values.wait === true;
  if (wait && (command.kind === "jobWait" || !command.longRunning)) {
    throw usageError(
      "--wait は Job を返す操作（asset.import / render.start）だけに指定できます。",
    );
  }
  const waitTimeoutMs = integerOption(
    "--timeout-ms",
    values["timeout-ms"],
    0,
    MAX_JOB_WAIT_TIMEOUT_MS,
  );
  const waitIntervalMs = integerOption(
    "--interval-ms",
    values["interval-ms"],
    MIN_JOB_WAIT_INTERVAL_MS,
    MAX_JOB_WAIT_INTERVAL_MS,
  );
  if (
    (waitTimeoutMs !== undefined || waitIntervalMs !== undefined) &&
    command.kind !== "jobWait" &&
    !wait
  ) {
    throw usageError(
      "--timeout-ms / --interval-ms は job.wait または --wait と一緒にだけ指定できます。",
    );
  }

  const input = values.input;
  if (input !== undefined && input.trim().length === 0) {
    throw usageError("--input には空でない値を指定してください。");
  }

  const agentId = nonEmpty(values["agent-id"]) ?? nonEmpty(env.KAKEAI_AGENT_ID) ?? DEFAULT_AGENT_ID;
  const dataRoot = nonEmpty(values["data-dir"]) ?? nonEmpty(env.KAKEAI_DATA_DIR);
  const socketPath = nonEmpty(values.socket) ?? nonEmpty(env.KAKEAI_SOCKET);
  const timeoutMs = integerOption("--timeout", values.timeout, 1, MAX_TIMER_DELAY_MS);

  return {
    kind: "run",
    command,
    options: {
      pretty: values.pretty === true,
      wait,
      agentId,
      ...(input === undefined ? {} : { input }),
      ...(dataRoot === undefined ? {} : { dataRoot }),
      ...(socketPath === undefined ? {} : { socketPath }),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      ...(waitTimeoutMs === undefined ? {} : { waitTimeoutMs }),
      ...(waitIntervalMs === undefined ? {} : { waitIntervalMs }),
      ...(jobId === undefined ? {} : { jobId }),
    },
  };
}
