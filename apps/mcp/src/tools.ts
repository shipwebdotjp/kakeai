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
    "Returns the current Content Schema, VisualTemplate input fields and constraints, warning codes, and the full operation catalog. Call this first.",
  "template.get":
    "Returns the input contract for one VisualTemplate. Includes `inputSchema` (JSON Schema derived from the same schema used for save-time validation) and a ready-to-use input `example`. Call it when `schema.get`'s `inputFields` do not reveal the shape, such as tables, charts, flows, line-triggered effects, or nesting. Replace each `<...>` in `example` with a real ID.",
  "work.list": "Returns the list of Works.",
  "work.get": "Returns one Work with its language editions and current Script Version summaries.",
  "work.create":
    "Creates a Work, its `ja-JP` language edition by default, and the initial Script Version.",
  "work.update":
    "Renames the Work's management title (`title`). The title shown inside the video is a Scene slot in the script and is separate from this field.",
  "work.clone":
    "Creates a child Work from the current version of the given Edition (`sourceEditionId`). `sourceEditionId` is required and must be an Edition that belongs to the source Work. The source Work is unchanged; the child Work gets `parentWorkId`, and its `originalLocale` and only Edition use the source locale. Only the current version of the given Edition is copied; other language editions, version history, Jobs, and thumbnails are not. There is no `requestId`, so after a timeout check `work.list` for `parentWorkId`, `title`, and `createdAt` before retrying. An unknown Work or Edition is WORK_NOT_FOUND.",
  "edition.create":
    "Adds a language edition to an existing Work. It copies the seed edition's current script and creates an initial version with voices and audio removed. Save the translation separately with script.save.",
  "script.get":
    "Returns a Script Version. Specify either `scriptVersionId` or `languageEditionId` (that Edition's current version), not both.",
  "script.listVersions":
    "Returns the Edition's full Script Version history, newest first (editions are expected to stay small). Requires `languageEditionId` and includes `currentScriptVersionId` plus a summary per version (version number, author, request ID, restore source, and createdAt). Does not include the ContentDocument. Use it to pick a past version for script.restore.",
  "script.validate":
    "Validates a script without saving and returns warnings and the resolved timeline. Pass either `content` or `baseScriptVersionId` + `operations`.",
  "script.subtitles":
    "Returns SRT subtitles for a saved Script Version. The response is `{ scriptVersionId, filename, mimeType, byteSize, srt }`. No render is needed; timing uses the same `resolveTimeline` as burned-in subtitles. Creates no Artifact or Job. If the timeline cannot be resolved, RENDER_INPUT_INVALID.",
  "script.diff":
    "Compares two saved Script Versions of the same Language Edition by element ID and returns structural additions, removals, content changes, and moves for scenes, lines, and visual cues. `updated` entries carry only stable top-level field names (`changedFields`), never values or a JSON Patch. A scene added or removed does not repeat its lines and cues as added or removed. `outsideScopeChangedFields` names changed top-level document fields that this operation does not compare (speakers, characters, audio takes, audio cues, theme, caption, and similar). Use it before a handoff to decide which details to read with `script.get`. Different Editions are VALIDATION_ERROR; an unknown version is RESOURCE_NOT_FOUND.",
  "script.save":
    "Validates a complete ContentDocument and saves it as a new Script Version. Intended for imports; use script.edit for normal editing. Optionally pass `baseScriptVersionId` to save only when it matches the current version, and `sourceScriptVersionId` to record a restore source from the same Edition.",
  "script.edit":
    "Applies an array of operation-core ScriptOperations and creates a new Script Version. `baseScriptVersionId` must match the current version, and `requestId` makes retries idempotent.",
  "script.restore":
    "Restores a past Script Version (`scriptVersionId`) as a new version. The ContentDocument is not sent; the server saves the source content. `requestId` is required, and a retry with the same ID returns the existing version. Optionally pass `baseScriptVersionId` to restore only when that version is current. Restoring the current version is VALIDATION_ERROR.",
  "asset.list":
    "Searches Assets and returns one page of `{ assets, nextCursor, total }`. Combine `kind`, `status`, `filename` (substring), `tags` (`tagMode` AND / OR, default `and`), `favorite`, `archived` (default `exclude`), `hasAudio`, `durationMinMs` / `durationMaxMs`, `widthPx` / `heightPx` (exact dimensions), and `widthMinPx` / `widthMaxPx` / `heightMinPx` / `heightMaxPx` (inclusive dimension ranges), and page with `sort` (default `createdAt_desc`) and `limit` (max 100). Assets without dimensions (such as audio) never match dimension filters. An inverted range, or an exact dimension outside the specified range, is VALIDATION_ERROR. `total` is the number of Assets matching the filters. To fetch the next page, pass the received `nextCursor` as `cursor` (a null `nextCursor` means the last page). Changing `sort` invalidates the `cursor`, so start over from the first page after reordering.",
  "asset.get": "Returns one Asset.",
  "asset.import":
    "Imports an Asset from a local path and returns a jobId. Check completion with kakeai_job_wait or kakeai_job_get.",
  "asset.update":
    "Updates an Asset's tags, favorite, or archive flag and returns the updated Asset. Besides `assetId`, specify at least one of `tags` / `favorited` / `archived`. Supplying `tags` replaces the whole array (an empty array clears all). `archived: true` does not delete the Asset; it only hides it from the default `asset.list` and pickers, so script references and renders keep working. There is no `requestId`, so after a timeout check `asset.get` before retrying. An unknown ID is RESOURCE_NOT_FOUND; a call with no fields is VALIDATION_ERROR.",
  "render.start":
    "Queues a render Job for the given Script Version and returns the Job. Check completion with kakeai_job_wait or kakeai_job_get.",
  "job.get": "Returns the state of one Job.",
  "job.list":
    "Returns a Work's Jobs. Select the kind with `kind` (default `render`; `render` / `tts`). `asset_ingest` is not tied to a Work and cannot be selected.",
  "job.cancel": "Cancels a queued Job, or a running render Job.",
  "preview.frame":
    "Returns a full-resolution PNG still at `timeMs` (milliseconds) from a render Artifact (MP4). The picture is returned as an image block; the resolved time and dimensions are returned as JSON. The JSON also carries the full-size PNG base64 (`pngBase64`); do not transcribe it, and use the image block when you need the picture.",
  "preview.scriptFrame":
    "Renders a saved Script Version (`scriptVersionId`) to a preview PNG. Give either an absolute `timeMs` (milliseconds), or `lineId` with an optional `offsetMs` (default 0) to address a Narration Segment resolved from that version's timeline; `timeMs` and `lineId` cannot be combined. The line form returns `resolvedLineId` and `resolvedTimeMs`. Creates no render Job, Script Version, or Artifact. Use it before rendering to check the layout of tables, charts, flows, standing images, and subtitles. The picture is returned as an image block; do not transcribe `imageBase64` from the JSON. The preview is for composition checks, and the human judges final color, motion, and audio after rendering.",
  "preview.assetFrame":
    "Returns the picture of one Asset. For images, the stored image itself (MIME type in `mimeType`); for videos, a PNG still at `timeMs` (default 0). Audio Assets are not supported. The picture is returned as an image block; do not transcribe `imageBase64` from the JSON. Use it to check how an Asset looks.",
  "preview.thumbnail":
    "Renders an unsaved thumbnail draft (`languageEditionId`, `template`, `input`, optional `appearanceOverride`, and optional Work-wide `appearance`) as a 1280x720 PNG. Writes nothing to the database. The picture is returned as an image block; do not transcribe `pngBase64` from the JSON. Use it before saving to check heading wrapping and foreground transparency. Omitting `appearance` uses the saved Work-wide Appearance; `null` disables it.",
  "preview.faceSet":
    "Composites an unsaved Face Set draft (`layers`, `expressions`, optional `expressionId` defaulting to `normal`, and `baseAssetId` of the ready image Asset to use as the base) and returns a PNG at the base image's dimensions, with brows, eyes, mouth, and foreground overlaid. Creates no database rows, Face Set, revision, Job, or Artifact. Use it before creating or updating a Face Set to check expression looks and alignment. The picture is returned as an image block; do not transcribe `pngBase64` from the JSON. CLI `--out` can write the PNG to a file.",
  "thumbnail.listTemplates":
    "Returns the bundled thumbnail templates with their input contracts. Each includes `inputSchema` (JSON Schema derived from the same schema used for save-time validation) and a ready-to-use `example`. Replace each `<...>` in `example` with a real image Asset ID. Do not guess the contract.",
  "thumbnail.list":
    "Lists the language edition's thumbnail candidates. Each candidate includes `isPrimary` and `appearanceOverride`. An unknown language edition is WORK_NOT_FOUND.",
  "thumbnail.get":
    "Returns one thumbnail candidate. An unknown ID is RESOURCE_NOT_FOUND.",
  "thumbnail.appearance":
    "Returns the Work-wide thumbnail Appearance resolved in that language edition's context, with Theme-derived defaults and resolved values. Saving the shared Appearance is limited to the app UI.",
  "thumbnail.create":
    "Creates a thumbnail candidate on the language edition and returns it. Specify `label`, `template`, `input`, and optional `appearanceOverride`. `input` follows thumbnail.listTemplates' `inputSchema`; background and foreground must be ready image Asset IDs. The first candidate automatically becomes primary. There is no `requestId`, so after a timeout check thumbnail.list for `label` and `createdAt` before retrying.",
  "thumbnail.update":
    "Partially updates a thumbnail candidate and returns it. Besides `thumbnailId`, send only the fields to change (`label`, `template`, `input`, `appearanceOverride`); omitted fields stay unchanged. `appearanceOverride: null` clears it. When changing only `template`, validation fills in the current `input`. `input` follows thumbnail.listTemplates' `inputSchema`. An unknown ID is RESOURCE_NOT_FOUND.",
  "thumbnail.setPrimary":
    "Selects the language edition's publishing thumbnail (primary). `thumbnailId` must be a candidate in the same language edition; `null` clears it. An unknown candidate is RESOURCE_NOT_FOUND.",
  "thumbnail.image":
    "Generates and returns the PNG (1280x720) of a saved thumbnail candidate on demand. Creates no Job or Artifact. The picture is returned as an image block; do not transcribe `pngBase64` from the JSON. In the CLI, `--out` can write the PNG to a file. An unknown ID is RESOURCE_NOT_FOUND.",
  "artifact.get":
    "Returns one Artifact's metadata and the absolute `filePath` of the actual file. A render MP4 has `role: \"render\"` / `format: \"mp4\"`. Bytes are not returned, so large videos are safe. `artifact.contentUrl` is for browsers and requires the media session cookie, so agents should copy or upload using `filePath`. If the file is missing or its size does not match the record, RESOURCE_NOT_FOUND.",
  "artifact.export":
    "Exports an Artifact to the given directory and returns `{ artifact, sourcePath, exportedPath }`. `outputDir` must be an existing absolute directory; `filename` is optional (no path separators, matching the Artifact's extension). The canonical file stays in the app's data root, and existing files are not overwritten (a name collision is EXPORT_TARGET_EXISTS). Large files use copy-on-write clones; failure is EXPORT_FAILED. After a timeout, check `outputDir` for a default-named file ending in `-{artifactId}.{extension}` and retry only if there is none. After EXPORT_FAILED, a retry becomes EXPORT_TARGET_EXISTS if a partial file with the same name remains.",
  "composition.list": "Returns the list of Compositions.",
  "composition.get": "Returns one Composition.",
  "composition.draft.get": "Returns a Composition's draft files and manifest.",
  "composition.authoringContext":
    "Returns the authoring context for creating a Composition. Accepts the same input as HTTP (`visualTheme` and optional `canvasProfile`).",
  "composition.create":
    "Creates a Composition draft. Optionally specify an authoring style.",
  "composition.draft.update":
    "Partially updates a Composition draft's files and manifest.",
  "composition.publish":
    "Publishes a Composition and creates an immutable version. With `dryRun: true`, only validates and creates no version.",
  "tts.create":
    "Queues a synthesis Job for one line of a saved Script Version on the user's configured TTS Adapter (voicevox / aivisspeech / openai-compatible) and returns the Job. `speedScale` defaults to 1.0. Check completion with kakeai_job_wait or kakeai_job_get, then turn `ttsResult` into a Take with `line.assignTake` in `script.edit`.",
  "tts.createBulk":
    "Queues synthesis Jobs in bulk for lines that have no selected audio in the saved Script Version's point scenes. Returns the queued Jobs and the lines that could not be generated (code and reason). Check each Job with kakeai_job_wait or kakeai_job_get.",
  "tts.attachBulk":
    "Finalizes the result of a tts.createBulk started with a requestId and attaches only the successful Jobs to one Script Version. Inputs are the original Script Version (`scriptVersionId`), the original bulk request's `bulkRequestId`, and this attach's own required `requestId`. If any Job is unfinished, returns `pending` without changing the script; once all Jobs are terminal, attaches the successful ones and returns `finalized`. Returns counts, exclusions, failure reasons, and the resulting Script Version (null when nothing was attached). A retry with the same `requestId` returns the existing version. If the script changed before finalization, `SCRIPT_BASE_STALE`.",
  "character.list":
    "Returns the Character library. To use one in a script, copy it with script.edit's character.addFromLibrary. Deleting library entries is not exposed.",
  "character.get":
    "Returns one Character library entry with its locale-keyed voices and appearances (including Face Set references and the default standing placement `standing`). An unknown ID is RESOURCE_NOT_FOUND.",
  "character.create":
    "Creates one Character library entry and returns it. Specify `name`, optional locale-keyed `names`, `voices` (Voice Profiles per locale), and `appearances` (each with `assetId` of an imported ready image Asset, an existing `faceSetId` matching the base image's dimensions, and optional `standing` `{ scale, edge, vertical }` for the default standing placement). The server assigns appearance IDs. After a timeout, check character.list before retrying.",
  "character.update":
    "Partially updates one Character library entry and returns it. Besides `characterId`, send only the changed `name` / `names` / `voices`; omitted fields stay unchanged. A supplied `names` / `voices` replaces the whole array. Use `character.addAppearance` / `character.updateAppearance` to add or change appearances. An unknown ID is RESOURCE_NOT_FOUND; a reference, dimension, or locale mismatch is VALIDATION_ERROR.",
  "character.addAppearance":
    "Adds one appearance to a Character library entry and returns it. Specify `characterId`, `assetId` (a ready image Asset), `expression`, `pose`, and optional `label`, `faceSetId` (an existing Face Set matching the base image's dimensions), and `standing` (optional `{ scale, edge, vertical }` default standing placement). The server assigns the ID and appends it to the array. The limit is 50 appearances. An unknown Character is RESOURCE_NOT_FOUND; a reference or dimension mismatch is VALIDATION_ERROR.",
  "character.updateAppearance":
    "Partially updates one appearance of a Character library entry and returns it. Besides `characterId` and `appearanceId`, send only the fields to change (`assetId`, `expression`, `pose`, `label`, `faceSetId`, `standing`); omitted fields stay unchanged, while `label: null` and `faceSetId: null` explicitly clear. `standing` replaces the whole `{ scale, edge, vertical }`. If updating only `assetId` would make it inconsistent with the Face Set's dimensions, first clear it with `faceSetId: null` or send both. An unknown Character or appearance is RESOURCE_NOT_FOUND; a reference or dimension mismatch, or zero update fields, is VALIDATION_ERROR.",
  "character.setVoices":
    "Replaces a Character's voices (Voice Profile assignments per locale) and returns it. `voices` is an array of `{ locale, voiceProfileId }`; each Profile must exist and its `locale` must match. An empty array clears all voices. Appearances are unchanged. An unknown ID is RESOURCE_NOT_FOUND.",
  "theme.list":
    "Returns the selectable Visual Themes. Includes built-in Themes and only the latest Revision of each unarchived user Theme. Theme Drafts, archived Themes, and older Revisions are excluded.",
  "theme.get":
    "Returns one Visual Theme definition. Omitting `version` returns the latest published Revision listed by `theme.list`. Passing `version` returns that published Revision and can also read an archived Theme's Revision (existing Works may still reference it). A Theme Draft or unknown Revision is RESOURCE_NOT_FOUND.",
  "theme.diagnose":
    "Returns the font diagnosis for a Theme Revision. Accepts `themeId`, optional `version` (latest published Revision when omitted; an archived Theme is RESOURCE_NOT_FOUND unless you pass `version`), `locale` (default ja-JP), and `verify` (default true). `roles` gives the resolved local face and fallback status per text role, `missingFonts` lists families that could not be resolved, and `diagnostics` gives human-readable explanations. `verify: true` checks local face resolution in Chromium just like rendering, so the first call is slow. `verify: false` does a fast catalog-only check.",
  "theme.create":
    "Creates a Visual Theme and returns its initial Draft. Specify `name` and optional `sourceThemeRef` (the copy source; defaults to the built-in Soft Editorial). A new Theme has no published Revision, so edit `draft` and proceed through `theme.draft.save` → `preview.theme` → `theme.publish`. Deleting or archiving Themes is not exposed. After a timeout, check theme.list for the name before retrying.",
  "theme.draft.get":
    "Returns the Theme's editing Draft, or `draft: null` when there is none. Built-in Themes also return `draft: null`. An unknown Theme is RESOURCE_NOT_FOUND.",
  "theme.draft.save":
    "Saves the Theme Draft (creating one if absent). Base `definition` on the definition read from `theme.draft.get` and send the complete definition with only the intended fields changed. Does not change the published Revision and does not consume a version. Built-in, unknown, and archived Themes are RESOURCE_NOT_FOUND.",
  "theme.publish":
    "Publishes the Theme Draft as a new published Revision and returns it. The Draft is discarded after publishing. No Draft is INVALID_STATE. After a timeout, check theme.get for the latest Revision and do not publish twice.",
  "preview.theme":
    "Renders an unsaved Theme definition with the representative sample and returns a PNG. Specify `definition`, optional `locale` (default ja-JP), and `timeMs` (default 4500ms). Creates no database rows, Theme Draft, Revision, Job, or Artifact. The default time is a key scene where heading, body, label, and caption are visible at once. Use it to check colors, spacing, and fonts; check font resolution with theme.diagnose.",
  "font.list":
    "Returns installed fonts with search and paging. `query` matches family, display name, or PostScript name as a substring; filter with `style`, `minWeight`, `maxWeight`, and `available`. `limit` defaults to 50 and is capped at 200; use `offset` for the next page. The response's `total` is the filtered count, `nextOffset` is the next page's offset (or null), and `catalog` is the catalog's support status and updated time. Use it to build a Theme's `fontFace`.",
  "faceSet.list":
    "Lists Face Sets with their latest version, Face Layers, and Expression Presets. To choose a line's expression for a Work, pass the `faceSetId` and `faceSetVersion` from script.get's appearances to `faceSet.get`, then pick from that pinned revision's `expressions[].id`. Creating and updating Face Sets is exposed; deleting is not.",
  "faceSet.get":
    "Returns one Face Set with its Face Layers and Expression Presets. Passing `version` returns that revision; omitting it returns the latest. When editing a Work's expressions, pass the `faceSetVersion` from script.get's appearances. An unknown ID or version is RESOURCE_NOT_FOUND.",
  "faceSet.create":
    "Creates a Face Set and returns it. Specify `name`, `layers` (Face Layers; `part` is brow / eye / mouth / foreground, and `assetId` is a same-size ready image Asset), and `expressions` (Expression Presets; `normal` is required). Check the composite with preview.faceSet before creating. There is no `requestId`, so after a timeout check faceSet.list for the name and createdAt before retrying.",
  "faceSet.update":
    "Partially updates a Face Set and returns it. Besides `faceSetId`, send only the fields to change (`name`, `layers`, `expressions`); omitted fields stay unchanged. A supplied array replaces the whole array. Changed content creates a new revision (version), and library Characters follow the latest revision immediately. Works keep using their pinned `faceSetVersion`. A name-only change or identical content does not increase the version. Keeping existing `expressionId`s when creating a revision carries the same intent across pinned versions. Content whose dimensions do not match the library appearance is VALIDATION_ERROR. An unknown ID is RESOURCE_NOT_FOUND. After a timeout, check faceSet.get for the latest version before retrying.",
  "faceSet.usages":
    "Returns the library Character appearances that reference a Face Set. Each element has characterId, characterName, appearanceId, label, assetId, widthPx, and heightPx. Use it before creating a revision to check base image dimensions and the blast radius. An unknown ID is RESOURCE_NOT_FOUND.",
  "voiceAdapter.list":
    "Returns the available TTS Adapter kinds. Each element has `id`, `label`, `defaultLocale`, `voiceSelection` (`list` / `list-or-manual`), and `modelSelection`; use it to pick `adapterId` for `voiceProfile.listVoices` / `voiceProfile.listModels` / `voiceProfile.create`. Connection URLs, environment variables, and credentials are not returned.",
  "voiceProfile.list":
    "Lists Voice Profiles with their Adapter, voice ID, locale, and settings. Before assigning a voice, choose a Profile whose locale matches the script's. If none exists, find a voice with voiceProfile.listVoices and create one with voiceProfile.create. Deleting Profiles is not exposed.",
  "voiceProfile.get":
    "Returns one Voice Profile. An unknown ID is RESOURCE_NOT_FOUND.",
  "voiceProfile.listVoices":
    "Returns a TTS Adapter's voice candidates. Use it to pick `voiceId` for voiceProfile.create. An unreachable Adapter is TTS_ENGINE_UNAVAILABLE.",
  "voiceProfile.listModels":
    "Returns a TTS Adapter's model candidates. Use it to pick `settings.model` for an `openai-compatible` voiceProfile.create. An unreachable Adapter is TTS_ENGINE_UNAVAILABLE.",
  "voiceProfile.create":
    "Creates a Voice Profile and returns it. Specify `adapterId`, an existing `voiceId` (confirm with voiceProfile.listVoices), `locale` (match the script's locale), and `settings` (`openai-compatible` requires `model`; when using reference audio, also requires `refAudioAssetId` (an imported audio Asset ID) and `langCode` (one of Japanese / English / Chinese / Korean / German / French / Russian / Portuguese / Spanish / Italian); `refText` (ICL mode when present, x-vector mode when omitted) and `maxTokens` are optional). After a timeout, check voiceProfile.list before retrying.",
  "voiceProfile.update":
    "Partially updates a Voice Profile and returns it. Besides `voiceProfileId`, send only the fields to change (`name`, `voiceId`, `locale`, `settings`); omitted fields stay unchanged. Supplying `settings` replaces the whole adapter settings object. `adapterId` cannot be changed. An unknown ID is RESOURCE_NOT_FOUND. Changes affect only future TTS and do not alter existing Audio Takes.",
  "youtubeSettings.get":
    "Returns the YouTube publishing settings for the given Edition. Requires `languageEditionId`.",
  "youtubeSettings.update":
    "Fully overwrites (last-write-wins) the YouTube publishing settings for the given Edition and returns them. `settings` is not a partial update; send the complete document based on `youtubeSettings.get`'s `document`. Requires `languageEditionId` and `settings`. There is no `requestId`, so after a timeout check `youtubeSettings.get` before retrying. An unknown Edition is RESOURCE_NOT_FOUND.",
  "script.youtubeChapters":
    "Generates YouTube video chapter text plus diagnostics and warnings from a saved Script Version's timeline and returns them. Requires `scriptVersionId`.",
};

function describeOperation(
  operation: AgentOperationName,
  kind: "read" | "mutation",
  longRunning: boolean,
): string {
  const kindText = kind === "read" ? "read" : "mutation";
  const jobText = longRunning
    ? " Queues a Job; check completion with kakeai_job_wait or kakeai_job_get."
    : "";
  return `${operationDescriptions[operation]} Operation: \`${operation}\` (${kindText}).${jobText}`;
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
    "Polls job.get with a bounded budget until the Job reaches a terminal state (succeeded / failed / cancelled). On budget exhaustion it returns `timedOut: true` and the last Job. Use it after asset.import / render.start / tts.create / tts.createBulk. This is an MCP binding convenience tool, not an Agent operation.",
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
