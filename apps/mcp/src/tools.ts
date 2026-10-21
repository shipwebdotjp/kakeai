import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  agentOperationCatalog,
  agentOperationInputSchemas,
  agentOperationOutputSchemas,
  toAgentJsonSchema,
  type AgentOperationName,
} from "@kakeai/contracts";
import { jobWaitInputSchema, jobWaitResultSchema } from "@kakeai/agent-client";

type ToolInputSchema = Tool["inputSchema"];
type ToolOutputSchema = NonNullable<Tool["outputSchema"]>;
type ToolAnnotations = NonNullable<Tool["annotations"]>;

interface BaseToolEntry {
  toolName: string;
  title: string;
  description: string;
  inputSchema: ToolInputSchema;
  outputSchema: ToolOutputSchema;
  annotations: ToolAnnotations;
}

export interface OperationToolEntry extends BaseToolEntry {
  kind: "operation";
  operation: AgentOperationName;
  readOnly: boolean;
  longRunning: boolean;
}

export interface JobWaitToolEntry extends BaseToolEntry {
  kind: "jobWait";
}

export type McpToolEntry = OperationToolEntry | JobWaitToolEntry;

/** MCP tool names are lowercase snake case: `kakeai_<domain>_<verb>`. */
export function mcpToolName(operation: AgentOperationName): string {
  const snake = operation
    .split(".")
    .map((segment) => segment.replace(/([a-z0-9])([A-Z])/gu, "$1_$2").toLowerCase())
    .join("_");
  return `kakeai_${snake}`;
}

export const MCP_TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]{0,127}$/u;

const operationDescriptions: Record<AgentOperationName, string> = {
  "schema.get":
    "現在の Content Schema、VisualTemplate の入力フィールドと制約、警告コード、全操作カタログを返す。最初に呼ぶ。",
  "work.list": "作品の一覧を返す。",
  "work.get": "作品 1 件を、言語版と現在の台本版の概要付きで返す。",
  "work.create": "作品、`ja-JP` 既定の言語版、初期台本版を作成する。",
  "work.update":
    "作品の管理上の作品名（`title`）を変更する。動画内に表示するタイトルは台本側の Scene スロットで、これとは別。",
  "script.get":
    "台本版を取得する。`scriptVersionId` または `languageEditionId`（その Edition の current）のどちらか一方を指定する。",
  "script.validate":
    "保存せずに台本を検証し、警告と解決済み timeline を返す。`content` または `baseScriptVersionId` + `operations` を渡す。",
  "script.save":
    "ContentDocument 全体を検証して新しい台本版として保存する。取り込み向けで、通常の編集は script.edit を使う。",
  "script.edit":
    "操作コアの ScriptOperation 配列を適用し、新しい台本版を作成する。`baseScriptVersionId` が current と一致している必要があり、`requestId` は再送を冪等にする。",
  "asset.list":
    "素材を検索して `{ assets, nextCursor, total }` の1ページを返す。`kind`・`status`・`filename`（部分一致）・`tags`（`tagMode` で AND / OR、既定 `and`）・`favorite`・`archived`（既定 `exclude`）・`hasAudio`・`durationMinMs` / `durationMaxMs` を組み合わせ、`sort`（既定 `createdAt_desc`）で `limit`（最大100）件ずつページングする。`total` は絞り込み条件に一致する件数。続きを取得するときは受け取った `nextCursor` を `cursor` に渡す（`nextCursor` が null なら最終ページ）。`sort` を変えると `cursor` は無効になるので、並べ替えたら先頭から取得し直す。",
  "asset.get": "素材 1 件を返す。",
  "asset.import":
    "ローカルパスの素材を取り込み、jobId を返す。完了状態は job_wait または job.get で確認する。",
  "asset.tag": "素材のタグを更新する。",
  "render.start":
    "指定した台本版のレンダー Job を投入し、Job を返す。完了は job_wait または job.get で確認する。",
  "job.get": "Job 1 件の状態を返す。",
  "job.list": "作品の Job 一覧を返す。",
  "job.cancel": "queued の Job をキャンセルする。",
  "preview.frame":
    "render 成果物（MP4）の指定時刻（`timeMs` ミリ秒）の静止画を原寸 PNG で返す。絵は image ブロック、解決時刻と寸法は JSON で返る。JSON にも原寸 PNG の base64（`pngBase64`）が入るため転記せず、絵が必要なときは image ブロックを使う。",
  "composition.list": "Composition の一覧を返す。",
  "composition.get": "Composition 1 件を返す。",
  "composition.draft.get": "Composition の draft ファイルと manifest を返す。",
  "composition.authoringContext":
    "Composition 作成用の authoring context を返す。HTTP と同じ入力（`visualTheme` と任意の `canvasProfile`）を受け取る。",
  "composition.create": "Composition の draft を作成する。任意で authoring style を指定できる。",
  "composition.draft.save": "Composition draft のファイルと manifest を部分更新する。",
  "composition.publish":
    "Composition を publish して不変 version を作る。`dryRun: true` なら検証だけを行い version を作らない。",
  "tts.create":
    "保存済み台本版の 1 セリフについて、利用者が設定済みの TTS Adapter（voicevox / aivisspeech / openai-compatible）へ合成 Job を投入し、Job を返す。`speedScale` の既定は 1.0。完了は job_wait または job.get で確認し、`ttsResult` を `script.edit` の `line.assignTake` で Take にする。",
  "tts.createBulk":
    "保存済み台本版の要点シーンで音声が未選択のセリフへ、まとめて合成 Job を投入する。投入した Job と、生成できなかったセリフ（コードと理由）を返す。完了は各 Job を job_wait または job.get で確認する。",
  "character.list":
    "キャラクターライブラリの一覧を返す。台本へ入れるときは script.edit の character.addFromLibrary でコピーする。ライブラリ自体の作成・更新・削除は公開しない。",
  "character.get":
    "キャラクターライブラリの 1 件を、locale 別の声と外観（Face Set 参照を含む）付きで返す。存在しない ID は RESOURCE_NOT_FOUND。",
};

function describeOperation(
  operation: AgentOperationName,
  kind: "read" | "mutation",
  longRunning: boolean,
): string {
  const kindText = kind === "read" ? "読み取り" : "変更";
  const jobText = longRunning
    ? " Job を投入し、完了は kakeai_job_wait または kakeai_job_get で確認する。"
    : "";
  return `${operationDescriptions[operation]} 操作名: \`${operation}\`（${kindText}）。${jobText}`;
}

function operationAnnotations(
  operation: AgentOperationName,
  readOnly: boolean,
): ToolAnnotations {
  return {
    readOnlyHint: readOnly,
    destructiveHint: false,
    // Reads are repeatable; script.edit is repeatable through its requestId.
    idempotentHint: readOnly || operation === "script.edit",
    openWorldHint: false,
  };
}

/**
 * The tool schemas come from the contract Zod schemas through the one shared
 * JSON Schema conversion in `@kakeai/contracts`. The generated schema is the
 * only schema exposed to agents; there is no hand-written duplicate. The same
 * conversion feeds the operation digest, so an agent sees exactly the schema
 * that was hashed.
 */
export const operationToolEntries: readonly OperationToolEntry[] =
  agentOperationCatalog.map((descriptor) => ({
    kind: "operation",
    operation: descriptor.name,
    toolName: mcpToolName(descriptor.name),
    title: descriptor.name,
    description: describeOperation(descriptor.name, descriptor.kind, descriptor.longRunning),
    inputSchema: toAgentJsonSchema(
      agentOperationInputSchemas[descriptor.name],
      "input",
    ) as unknown as ToolInputSchema,
    outputSchema: toAgentJsonSchema(
      agentOperationOutputSchemas[descriptor.name],
      "output",
    ) as unknown as ToolOutputSchema,
    annotations: operationAnnotations(descriptor.name, descriptor.kind === "read"),
    readOnly: descriptor.kind === "read",
    longRunning: descriptor.longRunning,
  }));

export const jobWaitToolEntry: JobWaitToolEntry = {
  kind: "jobWait",
  toolName: "kakeai_job_wait",
  title: "kakeai_job_wait",
  description:
    "Job が終端状態（succeeded / failed / cancelled）になるまで job.get を有界にポーリングする。budget 超過時は timedOut: true と最後の Job を返す。asset.import / render.start / tts.create / tts.createBulk の後に使う。MCP 束縛の便宜ツールで、Agent 操作ではない。",
  inputSchema: toAgentJsonSchema(jobWaitInputSchema, "input") as unknown as ToolInputSchema,
  outputSchema: toAgentJsonSchema(jobWaitResultSchema, "output") as unknown as ToolOutputSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

export const mcpToolEntries: readonly McpToolEntry[] = [
  ...operationToolEntries,
  jobWaitToolEntry,
];

const entriesByName = new Map(mcpToolEntries.map((entry) => [entry.toolName, entry]));

export function findToolEntry(toolName: string): McpToolEntry | undefined {
  return entriesByName.get(toolName);
}

export function toMcpTool(entry: McpToolEntry): Tool {
  return {
    name: entry.toolName,
    title: entry.title,
    description: entry.description,
    inputSchema: entry.inputSchema,
    outputSchema: entry.outputSchema,
    annotations: entry.annotations,
  };
}
