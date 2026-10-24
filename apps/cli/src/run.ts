import { setTimeout as delay } from "node:timers/promises";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  AgentClientError,
  bindingErrorPayload,
  bindingErrorText,
  createAgentClient,
  createJobGetter,
  jobWaitInputSchema,
  waitForJob,
  zodIssues,
  type JobWaitInput,
  type JobWaitResult,
} from "@kakeai/agent-client";
import {
  agentImageBase64Of,
  agentImageMetadataOf,
  agentOperationInputSchemas,
  agentOperationOutputSchemas,
  isAgentImagePreviewOperation,
  type AgentErrorIssue,
  type AgentImagePreviewOperationName,
  type AgentOperationInputMap,
  type AgentOperationName,
  type AgentOperationOutputMap,
} from "@kakeai/contracts";
import { parseCliArgs, readPackageVersion, type CliRunArgs } from "./config.ts";
import {
  CLI_ERROR_CODES,
  CliError,
  internalError,
  validationError,
} from "./errors.ts";
import { helpText, operationsCatalog } from "./help.ts";
import { readCliInput, readStdinText } from "./input.ts";

/** Same shape the MCP binding needs: a thin forward to the socket client. */
export interface CliRequester {
  request<N extends AgentOperationName>(
    operation: N,
    input: AgentOperationInputMap[N],
  ): Promise<AgentOperationOutputMap[N]>;
}

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  readStdin?: () => Promise<string>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Injected by tests; otherwise a real `@kakeai/agent-client` is created. */
  request?: CliRequester;
}

export function serializeJson(value: unknown, pretty: boolean): string {
  return `${pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value)}\n`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireObject(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) {
    const issue: AgentErrorIssue = {
      path: [],
      code: "invalid_type",
      message: "入力は JSON オブジェクトで指定してください。",
    };
    throw validationError([issue]);
  }
  return value;
}

function reportError(io: CliIo, error: unknown): number {
  if (error instanceof CliError) {
    io.stderr(bindingErrorText(bindingErrorPayload(error.code, error.issues)));
    return error.exitCode;
  }
  if (error instanceof AgentClientError) {
    io.stderr(bindingErrorText(bindingErrorPayload(error.code, error.issues)));
    return 1;
  }
  io.stderr(bindingErrorText(bindingErrorPayload(CLI_ERROR_CODES.INTERNAL_ERROR)));
  return 1;
}

function jobIdOf(
  operation: AgentOperationName,
  output: AgentOperationOutputMap[AgentOperationName],
): string | null {
  switch (operation) {
    case "asset.import":
      return (output as AgentOperationOutputMap["asset.import"]).jobId;
    case "render.start":
      return (output as AgentOperationOutputMap["render.start"]).job.id;
    case "tts.create":
      return (output as AgentOperationOutputMap["tts.create"]).job.id;
    case "tts.createBulk":
      // Bulk enqueues one Job per line, so there is no single Job to wait for.
      return null;
    default:
      throw internalError();
  }
}

function waitInputOf(
  jobId: string,
  options: { waitTimeoutMs?: number; waitIntervalMs?: number },
): JobWaitInput {
  return {
    jobId,
    ...(options.waitTimeoutMs === undefined ? {} : { timeoutMs: options.waitTimeoutMs }),
    ...(options.waitIntervalMs === undefined ? {} : { intervalMs: options.waitIntervalMs }),
  };
}

/**
 * Image preview operations with `--out <path>`: the image bytes go to the file
 * so stdout stays a small metadata JSON. Validation already passed, so this
 * only reshapes validated output and never prints an undescribed shape.
 */
async function writePreviewImageFile(
  output: AgentOperationOutputMap[AgentImagePreviewOperationName],
  out: string,
  io: CliIo,
): Promise<Record<string, unknown>> {
  const target = resolve(io.cwd ?? process.cwd(), out);
  const base64 = agentImageBase64Of(output);
  if (base64 === undefined) {
    throw internalError();
  }
  try {
    await writeFile(target, Buffer.from(base64, "base64"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new CliError(CLI_ERROR_CODES.OUTPUT_ERROR, 1, [
      {
        path: ["--out"],
        code: "write_failed",
        message: `--out のファイルに書き込めません: ${target} (${reason})`,
      },
    ]);
  }
  const metadata = agentImageMetadataOf(output);
  if (metadata === undefined) {
    throw internalError();
  }
  return { ...metadata, path: target };
}

async function runJobWait(
  requester: CliRequester,
  rawInput: JobWaitInput,
  io: CliIo,
): Promise<JobWaitResult> {
  return waitForJob(rawInput, {
    getJob: createJobGetter(requester),
    now: io.now ?? Date.now,
    sleep: io.sleep ?? ((ms) => delay(ms)),
  });
}

function inputSourceOptions(io: CliIo): { cwd: string; readStdin: () => Promise<string> } {
  return {
    cwd: io.cwd ?? process.cwd(),
    readStdin: io.readStdin ?? readStdinText,
  };
}

async function executeOperation(
  command: CliRunArgs,
  io: CliIo,
  requester: CliRequester,
): Promise<unknown> {
  if (command.command.kind !== "operation") {
    throw internalError();
  }
  const { operation } = command.command;
  const source = await readCliInput(command.options.input, inputSourceOptions(io));

  const parsed = agentOperationInputSchemas[operation].safeParse(source);
  if (!parsed.success) {
    throw validationError(zodIssues(parsed.error));
  }
  const output = await requester.request(
    operation,
    parsed.data as AgentOperationInputMap[AgentOperationName],
  );
  // Outputs are validated again so the CLI never prints a shape the contract
  // does not describe (the client already validates, injected stubs may not).
  const validatedOutput = agentOperationOutputSchemas[operation].safeParse(output);
  if (!validatedOutput.success) {
    throw new CliError(CLI_ERROR_CODES.INTERNAL_ERROR, 1, zodIssues(validatedOutput.error));
  }

  if (!command.options.wait) {
    if (isAgentImagePreviewOperation(operation) && command.options.out !== undefined) {
      return writePreviewImageFile(
        validatedOutput.data as AgentOperationOutputMap[AgentImagePreviewOperationName],
        command.options.out,
        io,
      );
    }
    return validatedOutput.data;
  }
  const jobId = jobIdOf(operation, validatedOutput.data);
  if (jobId === null) {
    return { result: validatedOutput.data, wait: null };
  }
  const wait = await runJobWait(requester, waitInputOf(jobId, command.options), io);
  return { result: validatedOutput.data, wait };
}

async function executeJobWait(
  command: CliRunArgs,
  io: CliIo,
  requester: CliRequester,
): Promise<unknown> {
  const source = await readCliInput(command.options.input, inputSourceOptions(io));
  const merged = {
    ...requireObject(source),
    ...(command.options.jobId === undefined ? {} : { jobId: command.options.jobId }),
    ...(command.options.waitTimeoutMs === undefined
      ? {}
      : { timeoutMs: command.options.waitTimeoutMs }),
    ...(command.options.waitIntervalMs === undefined
      ? {}
      : { intervalMs: command.options.waitIntervalMs }),
  };
  const parsed = jobWaitInputSchema.safeParse(merged);
  if (!parsed.success) {
    throw validationError(zodIssues(parsed.error));
  }
  return runJobWait(requester, parsed.data, io);
}

/**
 * Runs one CLI invocation. Returns the process exit code instead of exiting so
 * tests and the bin wrapper share the exact same behaviour.
 */
export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  let parsed: ReturnType<typeof parseCliArgs>;
  try {
    parsed = parseCliArgs(argv, io.env ?? process.env);
  } catch (error) {
    return reportError(io, error);
  }

  if (parsed.kind === "help") {
    io.stdout(`${helpText()}\n`);
    return 0;
  }
  if (parsed.kind === "version") {
    io.stdout(`${readPackageVersion()}\n`);
    return 0;
  }
  if (parsed.kind === "operations") {
    io.stdout(serializeJson(operationsCatalog(), parsed.pretty));
    return 0;
  }

  const requester =
    io.request ??
    createAgentClient({
      agentId: parsed.options.agentId,
      ...(parsed.options.dataRoot === undefined ? {} : { dataRoot: parsed.options.dataRoot }),
      ...(parsed.options.socketPath === undefined
        ? {}
        : { socketPath: parsed.options.socketPath }),
      ...(parsed.options.timeoutMs === undefined
        ? {}
        : {
            readTimeoutMs: parsed.options.timeoutMs,
            mutationTimeoutMs: parsed.options.timeoutMs,
          }),
    });

  try {
    const output =
      parsed.command.kind === "jobWait"
        ? await executeJobWait(parsed, io, requester)
        : await executeOperation(parsed, io, requester);
    io.stdout(serializeJson(output, parsed.options.pretty));
    return 0;
  } catch (error) {
    return reportError(io, error);
  }
}
