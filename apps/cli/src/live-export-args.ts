import { parseArgs } from "node:util";

export class CliError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly exitCode = 1,
    readonly details: unknown = undefined,
  ) {
    super(message);
  }
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 1000;

export function usage(): string {
  return [
    "Usage:",
    "  npm run live:export -- --program-version <id> --out <dir> [--fixture <file>]",
    "",
    "Options:",
    "  --program-version <id>   Live Program Version ID",
    "  --fixture <file>         fixture comments JSON",
    "  --out <dir>              New output directory (must not exist; absolute or relative)",
    "  --timeout-ms <ms>        total polling budget (default: 1800000)",
    "  --interval-ms <ms>       polling interval (default: 1000)",
    "  --help                   show this help",
  ].join("\n");
}

function parsePositive(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new CliError("LIVE_EXPORT_CLI_USAGE", `${name} は正の整数で指定してください。`, 2);
  }
  return parsed;
}

export type ParsedArgs =
  | { help: true }
  | {
      mode: "program";
      programVersionId: string;
      fixturePath: string | undefined;
      outDir: string;
      timeoutMs: number;
      intervalMs: number;
    };

function usageError(message: string): never {
  throw new CliError("LIVE_EXPORT_CLI_USAGE", message, 2);
}

function required(value: string | undefined, name: string): string {
  if (value === undefined || value.trim().length === 0) {
    usageError(`${name} は必須です。`);
  }
  return value.trim();
}

export function parseArgsOrHelp(args: readonly string[]): ParsedArgs {
  let values;
  try {
    ({ values } = parseArgs({
      args: [...args],
      strict: true,
      allowPositionals: false,
      options: {
        "program-version": { type: "string" },
        fixture: { type: "string" },
        out: { type: "string" },
        "timeout-ms": { type: "string" },
        "interval-ms": { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    }));
  } catch (error) {
    throw new CliError(
      "LIVE_EXPORT_CLI_USAGE",
      error instanceof Error ? error.message : String(error),
      2,
    );
  }
  if (values.help === true) {
    return { help: true };
  }

  const programVersion = values["program-version"];
  if (programVersion === undefined || programVersion.trim().length === 0) {
    usageError("--program-version は必須です。");
  }
  if (values.fixture !== undefined && values.fixture.trim().length === 0) {
    usageError("--fixture は空にできません。");
  }
  return {
    mode: "program",
    programVersionId: programVersion.trim(),
    fixturePath: values.fixture?.trim(),
    outDir: required(values.out, "--out"),
    timeoutMs: parsePositive(values["timeout-ms"], "--timeout-ms", DEFAULT_TIMEOUT_MS),
    intervalMs: parsePositive(values["interval-ms"], "--interval-ms", DEFAULT_INTERVAL_MS),
  };
}
