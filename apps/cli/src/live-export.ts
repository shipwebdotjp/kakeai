import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  jobSchema,
  liveAutoProfileResultSchema,
  liveFixtureCommentsSchema,
  liveShowProfileSchema,
  type Job,
  type LiveAutoProfileResult,
  type LiveExportFailure,
  type LiveShowProfile,
} from "@kakeai/contracts";
import { formatAutoProfileSummary } from "./live-profile.ts";

export interface LiveExportIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

export interface RunLiveExportOptions {
  fetchImpl?: typeof fetch;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_API_URL = "http://127.0.0.1:4317";
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 1000;
const REQUEST_TIMEOUT_MS = 30_000;

class CliError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly exitCode = 1,
    readonly details: unknown = undefined,
  ) {
    super(message);
  }
}

function usage(): string {
  return [
    "Usage:",
    "  npm run live:export -- --work <workId> --script-version <scriptVersionId> --profile <show-profile.json> --out <dir>",
    "  npm run live:export -- --work <workId> --script-version <scriptVersionId> --auto-profile --save-profile <show-profile.json> --out <dir>",
    "",
    "Options:",
    "  --work <id>              Work ID",
    "  --script-version <id>    ScriptVersion ID",
    "  --profile <file>         Show Profile JSON",
    "  --auto-profile           generate a Show Profile from the Work and ScriptVersion",
    "  --save-profile <file>    save the generated profile (required with --auto-profile)",
    "  --title <text>           override show.title (with --auto-profile)",
    "  --no-comments            do not generate comment corners (with --auto-profile)",
    "  --dry-run                generate and print the summary, but do not export",
    "  --force                  overwrite an existing --save-profile file",
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

function errorEnvelope(value: unknown): { code: string; message: string; details?: unknown } | null {
  if (typeof value !== "object" || value === null || !("error" in value)) {
    return null;
  }
  const error = (value as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  const message = (error as { message?: unknown }).message;
  if (typeof code !== "string" || typeof message !== "string") {
    return null;
  }
  return {
    code,
    message,
    details: (error as { details?: unknown }).details,
  };
}

async function readProfile(path: string): Promise<{ profile: LiveShowProfile; fixture?: unknown }> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new CliError("LIVE_EXPORT_PROFILE_NOT_FOUND", `プロファイルを読めません: ${path}`, 1);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CliError("LIVE_EXPORT_PROFILE_INVALID", "プロファイルのJSONが不正です。", 1);
  }
  const profile = liveShowProfileSchema.safeParse(parsed);
  if (!profile.success) {
    throw new CliError(
      "LIVE_EXPORT_PROFILE_INVALID",
      "Show Profile がスキーマに一致しません。",
      1,
      profile.error.issues,
    );
  }
  const fixturePath = profile.data.test?.fixture;
  if (fixturePath === undefined) {
    return { profile: profile.data };
  }
  const absoluteFixture = resolve(dirname(path), fixturePath);
  let fixtureRaw: string;
  try {
    fixtureRaw = await readFile(absoluteFixture, "utf8");
  } catch {
    throw new CliError(
      "LIVE_EXPORT_FIXTURE_NOT_FOUND",
      `fixture を読めません: ${absoluteFixture}`,
      1,
    );
  }
  let fixtureJson: unknown;
  try {
    fixtureJson = JSON.parse(fixtureRaw);
  } catch {
    throw new CliError("LIVE_EXPORT_FIXTURE_INVALID", "fixture のJSONが不正です。", 1);
  }
  const fixture = liveFixtureCommentsSchema.safeParse(fixtureJson);
  if (!fixture.success) {
    throw new CliError(
      "LIVE_EXPORT_FIXTURE_INVALID",
      "fixture がスキーマに一致しません。",
      1,
      fixture.error.issues,
    );
  }
  return { profile: profile.data, fixture: fixture.data };
}

function failureSummary(job: Job): LiveExportFailure[] {
  return job.liveExportResult?.failures ?? [];
}

function parseJobResponse(value: unknown): Job {
  const parsed = jobSchema.safeParse(value);
  if (!parsed.success) {
    throw new CliError(
      "LIVE_EXPORT_API_INVALID",
      "Kakeai API の Job 応答がスキーマに一致しません。",
      1,
      parsed.error.issues,
    );
  }
  return parsed.data;
}

async function requestJson(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new CliError(
      "LIVE_EXPORT_API_UNAVAILABLE",
      `Kakeai API に接続できません: ${error instanceof Error ? error.message : String(error)}`,
      1,
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new CliError("LIVE_EXPORT_API_INVALID", "Kakeai API の応答を解釈できません。", 1);
  }
  if (!response.ok) {
    const error = errorEnvelope(body);
    if (error !== null) {
      throw new CliError(error.code, error.message, 1, error.details);
    }
    throw new CliError("LIVE_EXPORT_API_ERROR", `HTTP ${response.status}`, 1);
  }
  return body;
}

interface CommonArgs {
  workId: string;
  scriptVersionId: string;
  timeoutMs: number;
  intervalMs: number;
}

type ParsedArgs =
  | { help: true }
  | (CommonArgs & { mode: "profile"; profilePath: string; outDir: string })
  | (CommonArgs & {
      mode: "auto";
      saveProfilePath: string | undefined;
      title: string | undefined;
      includeCommentCorners: boolean;
      force: boolean;
      dryRun: boolean;
      outDir: string | undefined;
    });

function usageError(message: string): never {
  throw new CliError("LIVE_EXPORT_CLI_USAGE", message, 2);
}

function required(value: string | undefined, name: string): string {
  if (value === undefined || value.trim().length === 0) {
    usageError(`${name} は必須です。`);
  }
  return value.trim();
}

async function requestAutoProfile(
  fetchImpl: typeof fetch,
  baseUrl: string,
  input: {
    workId: string;
    scriptVersionId: string;
    title?: string;
    includeCommentCorners: boolean;
  },
): Promise<LiveAutoProfileResult> {
  const response = await requestJson(fetchImpl, `${baseUrl}/api/v1/live-profiles/auto`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: new URL(baseUrl).origin,
    },
    body: JSON.stringify(input),
  });
  const parsed = liveAutoProfileResultSchema.safeParse(
    (response as { data?: unknown }).data,
  );
  if (!parsed.success) {
    throw new CliError(
      "LIVE_EXPORT_API_INVALID",
      "Kakeai API の自動生成応答がスキーマに一致しません。",
      1,
      parsed.error.issues,
    );
  }
  return parsed.data;
}

async function saveGeneratedProfile(
  path: string,
  profile: LiveShowProfile,
  force: boolean,
): Promise<void> {
  try {
    await stat(path);
    if (!force) {
      throw new CliError(
        "LIVE_EXPORT_PROFILE_EXISTS",
        `プロファイルが既に存在します: ${path}。上書きするには --force を指定してください。`,
        1,
      );
    }
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }
    if (!(error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT")) {
      throw new CliError(
        "LIVE_EXPORT_PROFILE_WRITE_FAILED",
        `プロファイルの確認に失敗しました: ${path}`,
        1,
      );
    }
  }
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
  } catch {
    throw new CliError(
      "LIVE_EXPORT_PROFILE_WRITE_FAILED",
      `プロファイルを書き込めません: ${path}`,
      1,
    );
  }
}

function parseArgsOrHelp(args: readonly string[]): ParsedArgs {
  let values;
  try {
    ({ values } = parseArgs({
      args: [...args],
      strict: true,
      allowPositionals: false,
      options: {
        work: { type: "string" },
        "script-version": { type: "string" },
        profile: { type: "string" },
        "auto-profile": { type: "boolean" },
        "save-profile": { type: "string" },
        title: { type: "string" },
        "no-comments": { type: "boolean" },
        "dry-run": { type: "boolean" },
        force: { type: "boolean" },
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

  const workId = required(values.work, "--work");
  const scriptVersionId = required(values["script-version"], "--script-version");
  const timeoutMs = parsePositive(values["timeout-ms"], "--timeout-ms", DEFAULT_TIMEOUT_MS);
  const intervalMs = parsePositive(values["interval-ms"], "--interval-ms", DEFAULT_INTERVAL_MS);
  const hasProfile = values.profile !== undefined;
  const autoProfile = values["auto-profile"] === true;
  const dryRun = values["dry-run"] === true;
  const force = values.force === true;
  const saveProfile = values["save-profile"];
  const title = values.title;

  if (hasProfile && autoProfile) {
    usageError("--profile と --auto-profile は同時に指定できません。");
  }
  if (!hasProfile && !autoProfile) {
    usageError("--profile または --auto-profile を指定してください。");
  }
  if (title !== undefined && title.trim().length === 0) {
    usageError("--title は空にできません。");
  }
  if (saveProfile !== undefined && saveProfile.trim().length === 0) {
    usageError("--save-profile は空にできません。");
  }

  if (hasProfile) {
    for (const [name, enabled] of [
      ["--save-profile", saveProfile !== undefined],
      ["--title", title !== undefined],
      ["--no-comments", values["no-comments"] === true],
      ["--dry-run", dryRun],
      ["--force", force],
    ] as const) {
      if (enabled) {
        usageError(`${name} は --auto-profile と一緒にだけ使えます。`);
      }
    }
    return {
      mode: "profile",
      workId,
      scriptVersionId,
      profilePath: required(values.profile, "--profile"),
      outDir: required(values.out, "--out"),
      timeoutMs,
      intervalMs,
    };
  }

  if (!dryRun && saveProfile === undefined) {
    usageError("--auto-profile には --save-profile が必要です（--dry-run を除く）。");
  }
  if (force && saveProfile === undefined) {
    usageError("--force は --save-profile と一緒にだけ使えます。");
  }
  const outDir =
    values.out === undefined ? undefined : required(values.out, "--out");
  if (!dryRun && outDir === undefined) {
    usageError("--out は必須です。");
  }
  return {
    mode: "auto",
    workId,
    scriptVersionId,
    saveProfilePath: saveProfile?.trim(),
    title: title?.trim(),
    includeCommentCorners: values["no-comments"] !== true,
    force,
    dryRun,
    outDir,
    timeoutMs,
    intervalMs,
  };
}

export async function runLiveExport(
  args: readonly string[],
  io: LiveExportIo,
  options: RunLiveExportOptions = {},
): Promise<number> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  try {
    const parsed = parseArgsOrHelp(args);
    if ("help" in parsed) {
      io.stdout(`${usage()}\n`);
      return 0;
    }
    const rawBaseUrl = (env.KAKEAI_API_URL ?? DEFAULT_API_URL).trim().replace(/\/+$/, "");
    let baseUrl: string;
    try {
      const parsedUrl = new URL(rawBaseUrl);
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        throw new Error("unsupported protocol");
      }
      baseUrl = `${parsedUrl.origin}${parsedUrl.pathname.replace(/\/+$/, "")}`;
    } catch {
      throw new CliError(
        "LIVE_EXPORT_CLI_USAGE",
        `KAKEAI_API_URL が不正です: ${rawBaseUrl}`,
        2,
      );
    }

    let profile: LiveShowProfile;
    let fixture: unknown;
    let outDir: string;
    if (parsed.mode === "profile") {
      ({ profile, fixture } = await readProfile(resolve(cwd, parsed.profilePath)));
      outDir = parsed.outDir;
    } else {
      const generated = await requestAutoProfile(fetchImpl, baseUrl, {
        workId: parsed.workId,
        scriptVersionId: parsed.scriptVersionId,
        ...(parsed.title === undefined ? {} : { title: parsed.title }),
        includeCommentCorners: parsed.includeCommentCorners,
      });
      profile = generated.profile;
      const savedPath =
        parsed.saveProfilePath === undefined
          ? undefined
          : resolve(cwd, parsed.saveProfilePath);
      if (savedPath !== undefined) {
        await saveGeneratedProfile(savedPath, profile, parsed.force);
      }
      io.stderr(
        formatAutoProfileSummary(generated, {
          ...(savedPath === undefined ? {} : { savedPath }),
          dryRun: parsed.dryRun,
        }),
      );
      if (parsed.dryRun) {
        return 0;
      }
      // Defensive: parseArgsOrHelp requires --out whenever this is not a dry run.
      if (parsed.outDir === undefined) {
        throw new CliError("LIVE_EXPORT_CLI_USAGE", "--out は必須です。", 2);
      }
      outDir = parsed.outDir;
    }

    const created = await requestJson(fetchImpl, `${baseUrl}/api/v1/live-exports`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: new URL(baseUrl).origin,
      },
      body: JSON.stringify({
        workId: parsed.workId,
        scriptVersionId: parsed.scriptVersionId,
        profile,
        ...(fixture === undefined ? {} : { fixture }),
        outDir: resolve(cwd, outDir),
      }),
    });
    const job = parseJobResponse((created as { data?: unknown }).data);
    const deadline = Date.now() + parsed.timeoutMs;
    let latest = job;
    for (;;) {
      if (latest.status === "succeeded") {
        io.stdout(
          `${JSON.stringify({
            jobId: latest.id,
            packagePath: latest.liveExportResult?.packagePath ?? null,
            packageId: latest.liveExportResult?.packageId ?? null,
            manifestSha256: latest.liveExportResult?.manifestSha256 ?? null,
            fileCount: latest.liveExportResult?.fileCount ?? null,
            preparedCueCount: latest.liveExportResult?.preparedCueCount ?? null,
            warnings: latest.liveExportResult?.warnings ?? [],
          })}\n`,
        );
        return 0;
      }
      if (latest.status === "failed" || latest.status === "cancelled") {
        io.stderr(
          `${JSON.stringify({
            jobId: latest.id,
            status: latest.status,
            error: latest.error,
            failures: failureSummary(latest),
          })}\n`,
        );
        return 1;
      }
      if (Date.now() >= deadline) {
        throw new CliError(
          "LIVE_EXPORT_TIMEOUT",
          `Job の完了を待てませんでした: ${latest.id}`,
          1,
        );
      }
      await sleep(parsed.intervalMs);
      let fetched: unknown;
      try {
        fetched = await requestJson(
          fetchImpl,
          `${baseUrl}/api/v1/jobs/${encodeURIComponent(latest.id)}`,
          { method: "GET" },
        );
      } catch (error) {
        if (
          error instanceof CliError &&
          (error.code === "LIVE_EXPORT_API_UNAVAILABLE" ||
            error.code === "LIVE_EXPORT_API_INVALID" ||
            error.code === "LIVE_EXPORT_API_ERROR" ||
            error.code === "INTERNAL_ERROR" ||
            error.code === "DATABASE_BUSY") &&
          Date.now() < deadline
        ) {
          continue;
        }
        throw error;
      }
      latest = parseJobResponse((fetched as { data?: unknown }).data);
    }
  } catch (error) {
    if (error instanceof CliError) {
      io.stderr(
        `${JSON.stringify({
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        })}\n`,
      );
      return error.exitCode;
    }
    io.stderr(
      `${JSON.stringify({
        code: "LIVE_EXPORT_INTERNAL_ERROR",
        message: error instanceof Error ? error.message : String(error),
      })}\n`,
    );
    return 1;
  }
}
