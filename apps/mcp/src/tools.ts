import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  agentOperationCatalog,
  agentOperationInputSchemas,
  agentOperationOutputSchemas,
  isAgentRequestIdRequiredOperation,
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
  "template.get":
    "VisualTemplate 1件の入力契約を返す。`inputSchema`（保存時検証と同じスキーマから導出した JSON Schema）と、そのまま使える入力例 `example` を含む。表・グラフ・フロー・セリフ同期の効果・入れ子など、`schema.get` の `inputFields` だけでは形が分からない入力を組み立てるときに呼ぶ。`example` の `<...>` は実在する ID に置き換える。",
  "work.list": "作品の一覧を返す。",
  "work.get": "作品 1 件を、言語版と現在の台本版の概要付きで返す。",
  "work.create": "作品、`ja-JP` 既定の言語版、初期台本版を作成する。",
  "work.update":
    "作品の管理上の作品名（`title`）を変更する。動画内に表示するタイトルは台本側の Scene スロットで、これとは別。",
  "work.clone":
    "元作品の現在版から子 Work を作る。元作品は変更せず、子 Work には `parentWorkId` が付く。複製されるのは元作品の `originalLocale` の Edition の現在版だけで、他の言語版・版履歴・Job・サムネイルは複製しない。`requestId` は持たないため、タイムアウト後は work.list で `parentWorkId` と `title`、`createdAt` を確認してから再実行する。不明な作品は WORK_NOT_FOUND。",
  "edition.create":
    "既存作品に言語版を追加する。シード元の現行台本をコピーし、声と音声を取り除いた初期版を作る。翻訳は script.save で別途保存する。",
  "script.get":
    "台本版を取得する。`scriptVersionId` または `languageEditionId`（その Edition の current）のどちらか一方を指定する。",
  "script.listVersions":
    "Edition の台本版履歴を新しい順に全件返す（Edition の版数は通常小さい）。`languageEditionId` が必要で、`currentScriptVersionId` と各版の要約（版番号・作成者・要求ID・復元元・作成日時）を含む。ContentDocument は含まない。過去版を選んで script.restore するときに使う。",
  "script.validate":
    "保存せずに台本を検証し、警告と解決済み timeline を返す。`content` または `baseScriptVersionId` + `operations` を渡す。",
  "script.save":
    "ContentDocument 全体を検証して新しい台本版として保存する。取り込み向けで、通常の編集は script.edit を使う。任意の `baseScriptVersionId` を渡すと現在の版と一致する場合だけ保存し、`sourceScriptVersionId` には同じ Edition の復元元の版を指定できる。",
  "script.edit":
    "操作コアの ScriptOperation 配列を適用し、新しい台本版を作成する。`baseScriptVersionId` が current と一致している必要があり、`requestId` は再送を冪等にする。",
  "script.restore":
    "過去の台本版（`scriptVersionId`）を新しい版として復元する。ContentDocument は送らず、サーバーが復元元の内容を保存する。`requestId` は必須で、同じ ID の再送は既存の版を返す。任意の `baseScriptVersionId` を渡すと、その版が current のときだけ復元する。復元元が current の場合は VALIDATION_ERROR。",
  "asset.list":
    "素材を検索して `{ assets, nextCursor, total }` の1ページを返す。`kind`・`status`・`filename`（部分一致）・`tags`（`tagMode` で AND / OR、既定 `and`）・`favorite`・`archived`（既定 `exclude`）・`hasAudio`・`durationMinMs` / `durationMaxMs` を組み合わせ、`sort`（既定 `createdAt_desc`）で `limit`（最大100）件ずつページングする。`total` は絞り込み条件に一致する件数。続きを取得するときは受け取った `nextCursor` を `cursor` に渡す（`nextCursor` が null なら最終ページ）。`sort` を変えると `cursor` は無効になるので、並べ替えたら先頭から取得し直す。",
  "asset.get": "素材 1 件を返す。",
  "asset.import":
    "ローカルパスの素材を取り込み、jobId を返す。完了状態は job_wait または job.get で確認する。",
  "asset.tag": "素材のタグを更新する。",
  "render.start":
    "指定した台本版のレンダー Job を投入し、Job を返す。完了は job_wait または job.get で確認する。",
  "job.get": "Job 1 件の状態を返す。",
  "job.list":
    "作品の Job 一覧を返す。`kind` で種別を選ぶ（既定 `render`、`render` / `tts`）。`asset_ingest` は作品に紐づかないため指定できない。",
  "job.cancel": "queued の Job をキャンセルする。",
  "preview.frame":
    "render 成果物（MP4）の指定時刻（`timeMs` ミリ秒）の静止画を原寸 PNG で返す。絵は image ブロック、解決時刻と寸法は JSON で返る。JSON にも原寸 PNG の base64（`pngBase64`）が入るため転記せず、絵が必要なときは image ブロックを使う。",
  "preview.scriptFrame":
    "保存済みの台本版（`scriptVersionId`）を、指定時刻（`timeMs` ミリ秒）のプレビュー PNG にする。レンダー Job・台本版・Artifact は作らない。render 前に表・グラフ・フロー・立ち絵・字幕の配置を確認したいときに使う。絵は image ブロックで返り、JSON の `imageBase64` は転記しない。プレビューは構図確認用で、最終的な色・動き・音の判断は render 後に人が行う。",
  "preview.assetFrame":
    "素材 1 件の絵を返す。画像は保存されている画像そのもの（MIME は `mimeType`）、動画は指定時刻（`timeMs`、既定 0）の PNG 静止画を返す。音声素材は指定できない。絵は image ブロックで返り、JSON の `imageBase64` は転記しない。素材の見た目を確認したいときに使う。",
  "preview.thumbnail":
    "未保存のサムネイル下書き（`languageEditionId`・`template`・`input`・任意の `appearanceOverride`・任意の Edition 共通 `appearance`）を 1280x720 の PNG にする。DB へは書かない。絵は image ブロックで返り、JSON の `pngBase64` は転記しない。保存前に見出しの折り返しと前景の透過を確認するときに使う。`appearance` を省略すると保存済みの Edition 共通 Appearance を使い、null なら使わない。",
  "thumbnail.listTemplates":
    "同梱サムネイルテンプレートの一覧を、入力契約付きで返す。`inputSchema`（保存時検証と同じスキーマから導出した JSON Schema）と、そのまま使える `example` を含む。`example` の `<...>` は実在する画像 Asset の ID に置き換える。契約を推測しない。",
  "thumbnail.list":
    "言語版のサムネイル候補を一覧で返す。各候補に `isPrimary` と `appearanceOverride` を含む。存在しない言語版は WORK_NOT_FOUND。",
  "thumbnail.get": "サムネイル候補 1 件を返す。存在しない ID は RESOURCE_NOT_FOUND。",
  "thumbnail.appearance":
    "言語版の共通サムネイル Appearance を、Theme 由来の既定値と解決済みの値付きで返す。共通 Appearance の保存はアプリ UI に限る。",
  "thumbnail.create":
    "言語版にサムネイル候補を作成して返す。`label`・`template`・`input` と任意の `appearanceOverride` を指定する。`input` は thumbnail.listTemplates の `inputSchema` に従い、背景と前景は ready な画像 Asset の ID にする。最初の候補は自動で primary になる。`requestId` は持たないため、タイムアウト後は thumbnail.list で `label` と `createdAt` を確認してから再実行する。",
  "thumbnail.update":
    "サムネイル候補を明示保存して返す。`label`・`template`・`input`・任意の `appearanceOverride` で上書きする（last-write-wins、版履歴なし）。`input` は thumbnail.listTemplates の `inputSchema` に従う。存在しない ID は RESOURCE_NOT_FOUND。",
  "thumbnail.setPrimary":
    "言語版の投稿用サムネイル（primary）を選ぶ。`thumbnailId` は同じ言語版の候補で、null で解除する。存在しない候補は RESOURCE_NOT_FOUND。",
  "thumbnail.image":
    "保存済みサムネイル候補の PNG（1280x720）をオンデマンドで生成して返す。Job・Artifact は作らない。絵は image ブロックで返り、JSON の `pngBase64` は転記しない。CLI では `--out` に PNG を書き出せる。存在しない ID は RESOURCE_NOT_FOUND。",
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
  "tts.attachBulk":
    "requestId付きで開始した tts.createBulk の結果を確定し、成功 Job だけを1つの台本版へ添付する。入力は元の台本版（`scriptVersionId`）、元の一括要求の `bulkRequestId`、添付自身の `requestId`（必須）。Jobが1件でも未完了なら台本を変更せず `pending` を返し、全Jobが終端状態になったら成功分だけを添付して `finalized` を返す。件数・対象外・失敗理由と、添付後の台本版（添付0件なら null）を返す。同じ `requestId` の再送は既存の版を返す。確定前に台本を書き換えると `SCRIPT_BASE_STALE` になる。",
  "character.list":
    "キャラクターライブラリの一覧を返す。台本へ入れるときは script.edit の character.addFromLibrary でコピーする。ライブラリの削除は公開しない。",
  "character.get":
    "キャラクターライブラリの 1 件を、locale 別の声と外観（Face Set 参照を含む）付きで返す。存在しない ID は RESOURCE_NOT_FOUND。",
  "character.create":
    "キャラクターライブラリに 1 件作成して返す。`name` と任意の `names`（locale 別の名前）・`voices`（locale 別の Voice Profile）・`appearances`（外観。`assetId` は取り込み済みの ready な画像 Asset、`faceSetId` は実在し、ベース画像と寸法が一致する Face Set）を指定する。外観の ID はサーバーが付ける。タイムアウト後は character.list で確認してから再実行する。",
  "character.update":
    "キャラクターライブラリの 1 件を部分更新して返す。`characterId` に加えて変更する項目だけを指定し、省略した項目は変更しない。指定した `names` / `voices` / `appearances` は配列全体を置き換えるため、変更時は character.get で読んだ全件を送る。既存の外観には `id` を付けて送り、新規の外観だけ `id` を省略する（省略するとサーバーが新しい ID を付ける）。外観の `assetId` は ready な画像 Asset、`faceSetId` は実在し、ベース画像と寸法が一致する Face Set。存在しない ID は RESOURCE_NOT_FOUND、参照・寸法・locale の不整合は VALIDATION_ERROR。",
  "character.setVoices":
    "キャラクターの声（locale 別の Voice Profile 割り当て）を置き換えて返す。`voices` は `{ locale, voiceProfileId }` の配列で、Profile は実在し `locale` が一致すること。空配列で全解除もできる。外観は変更しない。存在しない ID は RESOURCE_NOT_FOUND。",
  "theme.list":
    "選択できる Visual Theme の一覧を返す。組み込み Theme と、アーカイブされていないユーザー Theme の最新 Revision だけを含む。Theme Draft・アーカイブ済み Theme・古い Revision は含まない。",
  "theme.get":
    "Visual Theme 1件の定義を返す。`version` を省略すると、`theme.list` に載る最新公開 Revision を返す。`version` を指定すると、その公開 Revision を返し、アーカイブ済み Theme の Revision も読める（既存作品が参照している場合がある）。Theme Draft や存在しない Revision は RESOURCE_NOT_FOUND。",
  "theme.diagnose":
    "Theme Revision のフォント診断を返す。`themeId` と任意の `version`（省略時は最新公開 Revision で、アーカイブ済み Theme は RESOURCE_NOT_FOUND。`version` 指定時のみアーカイブ済み Theme の Revision も読める）・`locale`（既定 ja-JP）・`verify`（既定 true）を受ける。`roles` に文字 role ごとの解決済み local face とフォールバック有無、`missingFonts` に解決できなかった family、`diagnostics` に人が読める説明を返す。`verify: true` はレンダーと同じく Chromium で local face の解決可否を確認するため、初回は時間がかかる。`verify: false` はカタログ照合だけの速い診断になる。",
  "theme.create":
    "Visual Theme を作成し、初期 Draft を返す。`name` と任意の `sourceThemeRef`（複製元。省略時は組み込み Soft Editorial）を指定する。新しい Theme は公開 Revision を持たないため、`draft` を編集して `theme.draft.save` → `preview.theme` → `theme.publish` の順に進める。Theme の削除・アーカイブは公開しない。タイムアウト後は theme.list で名前を確認してから再実行する。",
  "theme.draft.get":
    "Theme の編集 Draft を返す。Draft が無ければ `draft: null`。組み込み Theme も `draft: null`。未知の Theme は RESOURCE_NOT_FOUND。",
  "theme.draft.save":
    "Theme Draft を保存する（無ければ作る）。`definition` は `theme.draft.get` で読んだ定義を元にし、変更したい項目だけを変えた完全な定義を送る。公開 Revision は変えず、版も消費しない。組み込み・未知・アーカイブ済み Theme は RESOURCE_NOT_FOUND。",
  "theme.publish":
    "Theme Draft を新しい公開 Revision として公開し、その Revision を返す。公開後 Draft は破棄される。Draft が無い場合は INVALID_STATE。タイムアウト後は theme.get で最新 Revision を確認し、二重に公開しない。",
  "preview.theme":
    "未保存の Theme 定義を代表サンプルでレンダーし、PNG を返す。`definition`・任意の `locale`（既定 ja-JP）・`timeMs`（既定 4500ms）を指定する。DB・Theme Draft・Revision・Job・Artifact は作らない。既定時刻は見出し・本文・ラベル・字幕が同時に見える要点シーン。色・余白・フォントの見え方を確認し、フォントの解決可否は theme.diagnose で確認する。",
  "font.list":
    "インストール済みフォントの一覧を、検索とページング付きで返す。`query` は family・表示名・PostScript 名の部分一致、`style`・`minWeight`・`maxWeight`・`available` で絞れる。`limit` は既定50・最大200、`offset` で次ページを取得する。応答の `total` は絞り込み後の件数、`nextOffset` は次ページの offset（無ければ null）、`catalog` はカタログの対応状況と更新時刻。Theme の `fontFace` を組み立てるときに使う。",
  "faceSet.list":
    "Face Set の一覧を、最新の version と Face Layer・Expression Preset 付きで返す。作品の台詞の表情は、script.get の外観にある `faceSetId` と `faceSetVersion` を `faceSet.get` に渡して、その固定版の `expressions[].id` から選ぶ。Face Set の作成・更新・削除は公開しない。",
  "faceSet.get":
    "Face Set 1件を、Face Layer と Expression Preset 付きで返す。`version` を指定するとその改訂版を返し、省略すると最新版を返す。作品の表情を編集するときは、script.get の外観にある `faceSetVersion` を指定する。存在しない ID や版は RESOURCE_NOT_FOUND。",
  "voiceAdapter.list":
    "利用可能な TTS Adapter の種別を返す。各要素は `id`・`label`・`defaultLocale`・`voiceSelection`（`list` / `list-or-manual`）・`modelSelection` を持ち、`voiceProfile.listVoices` / `voiceProfile.listModels` / `voiceProfile.create` の `adapterId` 選びに使う。接続先 URL・環境変数・認証情報は返さない。",
  "voiceProfile.list":
    "Voice Profile の一覧を、Adapter・voice ID・locale・設定付きで返す。声の割当て前に、台本の locale と一致する Profile を選ぶ。無ければ voiceProfile.listVoices で声候補を探して voiceProfile.create で作る。Profile の削除は公開しない。",
  "voiceProfile.get":
    "Voice Profile 1件を返す。存在しない ID は RESOURCE_NOT_FOUND。",
  "voiceProfile.listVoices":
    "TTS Adapter の声候補一覧を返す。voiceProfile.create の `voiceId` 選びに使う。接続できない Adapter は TTS_ENGINE_UNAVAILABLE。",
  "voiceProfile.listModels":
    "TTS Adapter のモデル候補一覧を返す。`openai-compatible` の voiceProfile.create の `settings.model` 選びに使う。接続できない Adapter は TTS_ENGINE_UNAVAILABLE。",
  "voiceProfile.create":
    "Voice Profile を新規作成して返す。`adapterId`・実在する `voiceId`（voiceProfile.listVoices で確認）・`locale`（台本の locale と一致させる）・`settings`（`openai-compatible` は `model` 必須、参照音声を使う場合は `refAudioAssetId`（取り込み済み音声 Asset の ID）・`langCode`（Japanese / English / Chinese / Korean / German / French / Russian / Portuguese / Spanish / Italian のいずれか）も必須、`refText`（付けると ICL 方式、省略すると x-vector 方式）・`maxTokens` は任意）を指定する。タイムアウト後は voiceProfile.list で確認してから再実行する。",
  "voiceProfile.update":
    "Voice Profile の `name`・`voiceId`・`locale`・`settings` を更新して返す。`adapterId` は変更できない。存在しない ID は RESOURCE_NOT_FOUND。反映は以後の TTS だけに影響し、既存の Audio Take は変えない。",
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
    // Reads are repeatable. Version-creating operations are repeatable through
    // their required requestId; the classification lives in contracts.
    idempotentHint: readOnly || isAgentRequestIdRequiredOperation(operation),
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
