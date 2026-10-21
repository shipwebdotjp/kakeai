import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import {
  AgentClientError,
  BINDING_VALIDATION_ERROR_CODE,
  createJobGetter,
  jobWaitInputSchema,
  waitForJob,
  type JobWaitInput,
  type JobWaitResult,
} from "@kakeai/agent-client";
import {
  agentOperationInputSchemas,
  type AgentOperationInputMap,
  type AgentOperationName,
  type AgentOperationOutputMap,
} from "@kakeai/contracts";
import {
  MCP_ERROR_CODES,
  toolErrorPayload,
  toolErrorText,
  zodIssues,
  type ToolErrorPayload,
} from "./errors.ts";
import { findToolEntry, mcpToolEntries, toMcpTool, type McpToolEntry } from "./tools.ts";

/** The subset of the Agent client the binding needs. */
export interface AgentRequester {
  request<N extends AgentOperationName>(
    operation: N,
    input: AgentOperationInputMap[N],
  ): Promise<AgentOperationOutputMap[N]>;
}

export interface McpServerOptions {
  request: AgentRequester;
  name?: string;
  version?: string;
  /** Injected by tests to keep polling deterministic. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Unexpected failures only; operation errors are normal results. */
  onInternalError?: (error: unknown) => void;
}

type UntypedRequest = (operation: AgentOperationName, input: unknown) => Promise<unknown>;

function errorResult(payload: ToolErrorPayload): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: toolErrorText(payload) }],
  };
}

function successResult(data: unknown): CallToolResult {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    // The MCP result contract needs an object for `structuredContent`.
    throw new Error("Agent operation returned a non-object result.");
  }
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
    structuredContent: data as Record<string, unknown>,
  };
}

function sleepFor(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Creates the MCP server. Every tool call is a thin forward to the Agent
 * Access operation (or, for `job_wait`, repeated `job.get`). No Kakeai
 * business logic lives here.
 */
export function createKakeaiMcpServer(options: McpServerOptions): Server {
  const request = options.request as unknown as { request: UntypedRequest };
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? sleepFor;
  const getJob = createJobGetter(options.request);

  async function callOperation(entry: McpToolEntry, args: unknown): Promise<CallToolResult> {
    if (entry.kind === "jobWait") {
      const parsed = jobWaitInputSchema.safeParse(args);
      if (!parsed.success) {
        return errorResult(
          toolErrorPayload(BINDING_VALIDATION_ERROR_CODE, zodIssues(parsed.error)),
        );
      }
      const result = await waitForJob(parsed.data satisfies JobWaitInput, {
        getJob,
        now,
        sleep,
      });
      return successResult(result satisfies JobWaitResult);
    }

    const operation = entry.operation;
    const parsed = agentOperationInputSchemas[operation].safeParse(args);
    if (!parsed.success) {
      return errorResult(
        toolErrorPayload(BINDING_VALIDATION_ERROR_CODE, zodIssues(parsed.error)),
      );
    }
    const output = await request.request(operation, parsed.data);
    return successResult(output);
  }

  const server = new Server(
    {
      name: options.name ?? "kakeai",
      version: options.version ?? "0.0.0",
    },
    {
      capabilities: { tools: {} },
      instructions: [
        "Kakeai Agent Access の MCP 束縛。操作を実行する前に kakeai_schema_get を呼び、",
        "Content Schema、VisualTemplate の入力制約、操作カタログ、警告コードを確認する。",
        "asset.import / render.start / tts.create / tts.createBulk は Job を投入して返るため、kakeai_job_wait または",
        "kakeai_job_get で完了を待つ。ツールが失敗した場合は isError: true と",
        "JSON { code, issues? } が返る。コードは再試行可否の判断に使う。",
      ].join(" "),
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: mcpToolEntries.map(toMcpTool),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (call): Promise<CallToolResult> => {
    const name = call.params.name;
    const entry = findToolEntry(name);
    if (entry === undefined) {
      return errorResult(toolErrorPayload(MCP_ERROR_CODES.TOOL_UNKNOWN));
    }

    try {
      return await callOperation(entry, call.params.arguments ?? {});
    } catch (error) {
      if (error instanceof AgentClientError) {
        return errorResult(toolErrorPayload(error.code, error.issues));
      }
      options.onInternalError?.(error);
      return errorResult(toolErrorPayload(MCP_ERROR_CODES.INTERNAL_ERROR));
    }
  });

  return server;
}
