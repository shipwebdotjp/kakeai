---
name: kakeai-production
description: >
  Produce or revise a complete Kakeai video through Agent Access: create the Work,
  author or import the script, copy library characters, find/import/tag assets,
  add visuals and BGM, synthesize narration with TTS, attach Takes, validate and
  queue the render. Use for any end-to-end video production with Kakeai's MCP
  tools (kakeai_*) or the kakeai-agent CLI. Start here; use kakeai-composition
  only when the video needs a new reusable CompositionVersion.
---

# Kakeai production flow

This skill is the end-to-end order of operations for one Kakeai video, plus the
rules that keep edits idempotent. It deliberately does **not** copy template
contracts or operation JSON schemas:

- Call `schema.get` first. It is the single source of truth for
  `contentSchemaVersion`, Visual Templates (`layers`, `inputFields`, constraints),
  `warningCodes`, `assetKinds`, the operation catalog (`agentOperations` with
  `kind` and `longRunning`), `schemaDigest` and `operationDigest`.
- Read each operation's input fields from the binding's published input schema:
  the MCP tool `inputSchema` (from `tools/list`) or the CLI's validation.
- For a Visual Template's input JSON, call `template.get` with the template
  `id`/`version` from `schema.get.templates`. It returns the template's
  `inputSchema` (the same schema that validates saves) and a valid `example`.
  Use it whenever the nested shape is not visible in `inputFields`; do not
  invent the JSON.
- Never guess field names, option values, or asset kinds.

Work only through Agent Access. Do not call Kakeai's HTTP API, do not open the
local control socket yourself, and never touch its Prisma database or app data
files.

## 1. Preflight

1. Confirm Kakeai is running as the same macOS user. Agent Access connects to a
   local socket; it does not launch the app. `AGENT_APP_UNAVAILABLE` means ask
   the user to start Kakeai — do not retry forever or switch transports.
2. Call `schema.get`:
   - MCP: `kakeai_schema_get` with `{}`
   - CLI: `kakeai-agent schema.get --pretty`
3. Record `schemaDigest`, `operationDigest` and `contentSchemaVersion`. If a
   digest changes later (app restarted or upgraded), re-read `schema.get` and
   the current script before the next mutation instead of trusting cached
   templates, operation shapes or IDs. `operationDigest` changes when an
   operation's input or output schema changed; `schemaDigest` also covers
   templates, warnings and the operation catalog.
4. Pick one binding for the session and stay with it. MCP tools are
   `kakeai_<domain>_<verb>` (`kakeai_tts_create_bulk`); CLI subcommands are the
   canonical `domain.verb` (`kakeai-agent tts.createBulk`). Same operations, same
   validation, same error codes.
   `kakeai-agent operations --pretty` lists the catalog with `kind` and
   `longRunning` if you need it without a schema fetch.
5. Check the voice precondition before planning TTS. For an existing Work,
   read the current script and confirm the speakers you will use have a
   `voiceProfileId` (`script.get` → `speakers[]`), and check that Profile with
   `voiceProfile.get`. For a new Work, call `voiceProfile.list` and choose a
   Profile whose `locale` exactly matches the target locale. If no Profile
   exists, stop before starting TTS and ask the human to create a Voice Profile
   in the app (§4). Do not queue TTS for voice-less speakers.

## 2. Order of work

| # | Phase | Operations | Decision point |
| --- | --- | --- | --- |
| 1 | Preflight | `schema.get` | Digest and catalog confirmed |
| 2 | Work and script | `work.create`, `work.update`, `script.get`, `script.save` or `script.edit` | Full import vs. structural edits |
| 3 | Characters and voices | `voiceProfile.list`, `character.list`, `character.get`, `script.edit` + `speaker.add` / `speaker.setVoiceProfile` / `character.addFromLibrary` | A locale-matching Voice Profile exists; use `character.addFromLibrary` when an on-screen Character is needed |
| 4 | Assets | `asset.list`, `asset.import`, `job.get` / `job.wait`, `asset.get`, `asset.tag` | Reuse a ready asset or import one |
| 5 | Visuals and audio | `script.edit` (`cue.add` / `cue.setInput` / `standing.set` / `audio.add`) | Template and asset chosen from the catalog |
| 6 | TTS | `tts.create` (+ `line.assignTake`) or `tts.createBulk` + `tts.attachBulk` | Which lines actually need a voice |
| 7 | Validate | `script.validate` | No errors, warnings understood |
| 8 | Optional pre-render visual check | `preview.scriptFrame`, `preview.assetFrame` | Layout, text overflow, overlap, missing media |
| 9 | Render and optional visual check | `render.start`, `job.get` / `job.wait`, `preview.frame` | `succeeded` + MP4 Artifact (`role: "render"`, `format: "mp4"`); the user judges final quality |

Do not interleave a later phase into an earlier one unless the earlier phase is
saved. Every `script.edit` reads `baseScriptVersionId`, so a stale base fails.

The acceptance line for the MP4 production flow (voice preflight, render
success + MP4 Artifact, optional stills) is defined in
`docs/agent-mp4-production/spec.md`. This skill is the order of operations, not
a second copy of that contract.

## 3. Work and script

- `work.create` returns the Work with its `languageEditions`. The initial
  ContentDocument is created in the requested `locale` (`ja-JP` by default;
  `en-US` is supported), so the first `script.edit` does not fail on a locale
  mismatch. Use the first edition unless the user asked for another locale.
- To make another language of the same Work, use `edition.create` with
  `workId`, the target `locale` (`en-US`) and `sourceEditionId` (the current
  edition you translated from). It copies the source current script
  (scenes, cues, characters) and strips voices and audio takes, so the new
  edition starts as subtitles-only with TTS unset. A locale that already
  exists is `LANGUAGE_EDITION_EXISTS`; a source from another Work is
  `WORK_NOT_FOUND`.
- To translate, `script.get` the source edition's current version, translate
  the text fields, then `script.save` the translated `ContentDocument` to the
  target `languageEditionId`. The document `locale` must equal the target
  edition's locale or the save is `VALIDATION_ERROR`. Then continue the
  normal flow on the new edition: pick voices for its locale, run TTS,
  validate, render. The translation source is a different Edition, so it
  cannot be recorded with `sourceScriptVersionId` (that field only accepts a
  version of the same Edition).
- `work.update` renames the Work's management title (`workId` + `title`). The
  title shown inside the video is a Scene slot in the ContentDocument, not this
  field; change that through `script.edit`.
- `work.clone` (`workId` + `title`) creates a child Work from the source Work's
  current version. It copies only the `originalLocale` edition's current
  ScriptVersion, records `parentWorkId` and `sourceScriptVersionId`, and does
  not copy the other editions, version history, Jobs, Artifacts or thumbnails.
  Use it to branch an experiment without rewriting the original. The child Work
  blocks deletion of the parent until a human deletes it, so do not clone
  casually. `work.clone` has no `requestId`; after a timeout, check
  `work.list` for a child with the same `parentWorkId` and title before
  retrying (§9).
- `script.listVersions` (`languageEditionId`) returns the edition's Script
  Version history newest first, with `currentScriptVersionId` and per-version
  summaries (version number, author, request id, `sourceScriptVersionId`,
  createdAt). The ContentDocument is not included; use `script.get` for one
  version. The response is the full history; editions are expected to stay
  small, so pagination is not part of this surface.
- `script.restore` (`scriptVersionId`, optional `baseScriptVersionId`, required
  `requestId`) restores an earlier version as a new version. You never send the
  ContentDocument: the server reads the source, validates it, records
  `sourceScriptVersionId`, and attributes the new version to the agent. Pass the
  current version as `baseScriptVersionId` when a concurrent edit should make
  the restore fail with `SCRIPT_BASE_STALE`; omit it only when last-write-wins
  is intended. Restoring the current version is `VALIDATION_ERROR`. A replay
  with the same `requestId` and the same source/base returns the existing
  version (`replay: true`); do not retry with a different source or base.
- `script.get` with `languageEditionId` returns that edition's current version;
  with `scriptVersionId` it returns one specific version. Keep the returned
  `scriptVersion.id` as the base for the next edit.
- **Full import** — `script.save` with `languageEditionId` and a complete
  `ContentDocument`. Use it when the script was authored outside Kakeai. It is a
  whole-document replacement and one new version. Validate before sending if the
  document is machine-generated.
  - Optional `baseScriptVersionId` is a base guard: when given, the save only
    succeeds if that version is still current, otherwise `SCRIPT_BASE_STALE`.
    Omitting it keeps the last-write-wins behaviour.
  - Optional `sourceScriptVersionId` records the restore source. It must be a
    version of the same Edition; a version of another Edition (including a
    translation source) is `VALIDATION_ERROR`.
  - `script.save` has no `requestId`. After a timeout, confirm with `script.get`
    before saving again (§9).
- **Structural edits** — `script.edit` with `baseScriptVersionId`, a unique
  `requestId`, and the operation array. Use it for scenes, lines, cues, standing,
  audio and takes.
- Batch related operations into one `script.edit` call. One call = one new
  ScriptVersion; do not create a version per field change. Creation operations
  can carry a `key`, and later operations in the same call can reference that
  creation as `{ "key": "..." }`.
- One call should express one intended change. If two changes are independent
  and either may fail, split them so a failure does not discard both.
- The default script already has intro / point / outro scenes. Add scenes with
  `scene.add` (`point` for narration, `insert` for a source video), split long
  ones with `scene.splitAtLine` or `line.split`, and add narration with
  `line.add`.

## 4. Characters, voices and libraries

The character, voice profile, face set and theme libraries are **read-only** on
the agent surface. `speaker.add` and `speaker.setVoiceProfile` change the
script's speakers, never a library entry.

### Voice preflight

1. **Existing Work** — `script.get` the edition and read
   `speakers[].voiceProfileId`. Check the Profile with `voiceProfile.get`: it
   must exist and its `locale` must exactly equal the script `locale`. A speaker
   with a valid voice can keep it; reuse it for TTS.
2. **New Work, or a speaker without a voice** — call `voiceProfile.list` and
   choose a Profile whose `locale` exactly equals the target locale (for example
   `ja-JP`; `en` does not match `en-US`). Use `character.list` only when an
   on-screen Character is also needed.
3. If no matching Profile exists, **stop before TTS** and ask the human to
   create a Voice Profile in the app. Do not start TTS with a voice-less
   speaker.
4. **Standard voice-only speaker flow** — in one `script.edit`, create the
   speaker and its first line together. The `key` lets `line.add` reference the
   speaker in the same call:

   ```json
   {
     "baseScriptVersionId": "scr-003",
     "requestId": "edit-2026-10-25-1",
     "operations": [
       { "op": "speaker.add", "key": "speaker-1", "name": "Narration", "voiceProfileId": "vp-001" },
       { "op": "line.add", "sceneId": "scene-002", "speakerId": { "key": "speaker-1" }, "captionText": "First point." }
     ]
   }
   ```

   `speaker.add` creates a Speaker with `characterId: null` and the given
   Profile. Read `created.speakerIds` if you need the new ID later.
5. **Existing speaker** — `speaker.setVoiceProfile` with the `speakerId` and an
   existing `voiceProfileId`, or `null` to clear it. For a Character-linked
   speaker the Character Voice is authoritative: the Profile must equal the
   Character's Voice for the document locale. If the Character has no Voice for
   the locale, only clearing to `null` is allowed. A missing speaker/Profile is
   `EDIT_TARGET_NOT_FOUND`; a locale or Character Voice mismatch is
   `EDIT_PRECONDITION_FAILED`. Changing a voice affects future TTS only;
   existing Audio Takes do not change.
6. **On-screen Character** — `character.addFromLibrary` remains the path when a
   standing appearance is needed. It copies the Character and its locale voice
   into the script.

A replay of a `script.edit` (same `requestId`) does **not** return `created` IDs.
If a call containing only `speaker.add` times out, replay it to confirm the
version, then `script.get` the new version to find the Speaker.

### Copying a character

1. `character.list` returns all library entries; `character.get` returns one by
   `characterId`. Each entry carries `name`, locale-keyed `voices`, and
   appearances (`assetId`, `expression`, `pose`, optional `label`, `faceSetId`).
2. Choose an entry that has a voice for the edition's locale. A copy without a
   matching voice gets `voiceProfileId: null`, and TTS on its lines fails with
   `TTS_INPUT_INVALID`; ask the user instead of guessing a voice.
3. In the **first** `script.edit`, include
   `{ "op": "character.addFromLibrary", "libraryCharacterId": "..." }`. This
   copies the character into new local Character / Appearance / Speaker IDs.
   The operation has no `key`.
4. Read `created.characterIds`, `created.appearanceIds`, `created.speakerIds`
   from the result.
5. In a **second** `script.edit`, use those IDs with `line.setSpeaker` and
   `standing.set`. Same-call `{ "key": ... }` references cannot point at a
   `character.addFromLibrary` result.
6. When you switch a line to a voice-only speaker, omit `expressionId`.
   `line.setSpeaker` clears it automatically, but `line.add` rejects an explicit
   `expressionId` for a speaker with no Character, and `line.setExpression` also
   rejects one.

### Face sets

`character.get` → an appearance's `faceSetId` → `faceSet.get` → an
`expressions[].id` → `line.setExpression` with `expressionId`. Use it only for
lines whose speaker has a Character; a voice-only speaker has no face to switch.

### Themes

`theme.list` returns the selectable Themes with their latest published
`version`; `theme.get` returns that revision and its `definition`. Only the
listed version is selectable, and any other id/version is `RESOURCE_NOT_FOUND`.
Theme Drafts, archived Themes, non-latest revisions and font diagnostics are not
exposed. `document.setVisualTheme`
accepts a built-in revision or the latest revision of an unarchived user Theme.
`script.save` rejects a **change** to an archived or non-latest revision but
allows saving a document that keeps its existing Theme, even if that Theme is
archived.

Never create, update, archive or delete library characters, voices, face sets or
themes. Library changes are the user's job; agents only read them, copy a
Character into the script, or assign an existing Voice Profile to a speaker.

## 5. Assets

- Search with `asset.list`:
  - `kind` (`image` / `video` / `audio`, see `schema.get.assetKinds`),
    `status` (use `ready`), `filename` (case-insensitive substring),
    `tags` + `tagMode` (`and` = all, `or` = any), `favorite`, `hasAudio`,
    `durationMinMs` / `durationMaxMs`.
  - Tags match whole elements: `bgm` does not match `bgm_loop`, and ASCII
    letters compare case-insensitively (`Summer` matches `summer`).
  - `archived` defaults to `exclude`. Pass `include` / `only` only when the user
    asks for archived material.
  - Results are newest-first and paginated: `limit` defaults to 50 and is capped
    at 100. Pass the returned `nextCursor` back unchanged; a cursor belongs to
    the filter set and the `sort` that produced it, so start over from the
    first page after changing the order. `total` is the number of assets that
    match the filters.
- Import with `asset.import` using an absolute local path (the agent shares the
  user's machine and permissions). It returns `{ asset, jobId, deduplicated }`;
  `jobId: null` means identical bytes already existed.
- Wait for ingest with `job_wait` / `job.wait` (or poll `job.get`). Then re-read
  `asset.get` and require `status: "ready"` before referencing it. A pending or
  failed asset is `ASSET_UNAVAILABLE` at edit time.
- Tag with `asset.tag` after ingest. Use a stable production tag plus a role tag
  (for example `production/<slug>`, `background`, `bgm`) so later searches are
  reproducible. Tags are user-facing metadata; do not repurpose them for IDs.
- Never inline media bytes into a script. Scripts reference `assetId` only.

## 6. Visuals and audio

- Build cues from `schema.get.templates`, not memory. Pick the template
  `id`/`version`, a `layer` it allows, and fill `inputFields` within their
  declared constraints (required/optional, select options, numeric ranges,
  allowed `assetKinds`, transition/animation policies).
- `inputFields` describes the editor fields, not the nested JSON shape. When a
  template uses a grid, flow, line-triggered effects, a nested visual or video
  playback gates, call `template.get` first and start from its `example`:
  - `inputSchema` is the save-time schema, so validating against it is enough.
  - Replace every `<...>` placeholder (`<assetId>`, `<startLineId>`,
    `<compositionVersionId>`, ...) with a real id from `asset.get`,
    `script.get` or `composition.get`.
  - If an example contains a nested `{ "kind": "template", "template": ... }`,
    call `template.get` again for that nested template. Do not stop at one
    level.
- Add with `cue.add`; adjust later with `cue.setInput` (partial merge) or
  `cue.setRange`. Put left/right characters on screen with `standing.set`.
- Add scene or work BGM with `audio.add`: `role: "bgm"`, a ready audio asset,
  `range: { kind: "scene", sceneId }` or `{ kind: "work" }`. A work may have at
  most one work-range BGM.
- Use a ready asset for every media field. A published CompositionVersion goes
  in a background cue only; authoring that version is the `kakeai-composition`
  skill's job.
- Validate incrementally. `script.validate` accepts either
  `{ content }` (validate a document you already have) or
  `{ baseScriptVersionId, operations }` (dry-run the next edit without saving).

## 7. TTS

TTS is available only through the adapter the user already configured
(`voicevox`, `aivisspeech` or `openai-compatible`). You cannot change endpoints,
credentials, adapter settings, voice profiles, or trigger any other paid
generation.

1. Make sure the target script is saved and every target speaker has a
   `voiceProfileId` whose Profile exists and matches the script locale (§4).
   Both TTS operations take a `scriptVersionId`; unsaved local edits are not
   visible to them. If any target speaker has no voice, stop and ask the human
   to create a Voice Profile — do not start TTS.
2. `tts.create` synthesizes one Narration Segment:
   - Required: `scriptVersionId`, `narrationSegmentId`.
   - Optional: `speechText` (defaults to the saved segment text),
     `voiceId` (defaults to the speaker's Voice Profile), `speedScale`
     (default `1.0`, allowed `0.5`–`2.0`), `requestId` (see §9.1).
   - Prefer omitting `speechText` so the Job speaks exactly the saved line. If
     you override it, update the line to the same text before attaching.
   - Returns `{ job }` with `kind: "tts"`.
3. `tts.createBulk` synthesizes every point-scene line that has no selected
   take. The contract makes `requestId` optional, but **finalization requires
   it** — always pass one (§9.1). It returns `{ jobs, excluded }`;
   `excluded` carries per-line stable codes and safe reasons and does not
   fail the whole call.
4. Finalize with `tts.attachBulk` (`scriptVersionId`, the bulk's
   `bulkRequestId`, and a fresh `requestId` for the attach itself). Call it on
   the **same binding with the same `agentId`** that started the bulk:
   - While any Job is still running it returns `pending` with the per-status
     counts. Poll it again instead of attaching takes yourself.
   - Once every Job is terminal it returns `finalized` and attaches only the
     succeeded Jobs in one new ScriptVersion. Read that version's id from
     `scriptVersion` (`null` means nothing was attachable).
   - Never attach bulk results with `script.edit` + `line.assignTake` by
     hand: the server restores the Job set from its ledger and verifies
     lines, speech text and ready assets for you. Single-line TTS (§7 first
     half) still uses `line.assignTake`.
   - Do not rewrite the script between `tts.createBulk` and `tts.attachBulk`.
     A newer version makes the base stale (`SCRIPT_BASE_STALE`) and the
     attach stops without attaching anything.
5. On `finalized`, `failures` names the failed/cancelled or unverifiable
   lines with reasons. To retry them, run a new `tts.createBulk` with a new
   `bulkRequestId` against the returned version (or the original version when
   `scriptVersion` is `null`), then `tts.attachBulk` again.
6. Before attaching a **single** TTS take, `script.get` the latest version and
   check that:
   - the `narrationSegmentId` still exists, and
   - its `speechText` is what you actually synthesized.
   If either changed, **discard the take and synthesize again**. Never attach
   audio that speaks different text than the line.
7. Attach the single take with `script.edit` + `line.assignTake` (`assetId`
   from `ttsResult`, `source: "tts"`). This creates a new ScriptVersion with
   a new Audio Take; it does not modify the generated Asset or the previous
   version.
8. A failed Job carries a stable code in `job.error`. `TTS_ENGINE_UNAVAILABLE`
   means the user's TTS engine is not reachable: ask them to start it. Do not
   switch adapters or invent an endpoint.

## 8. Validate, preview and render

1. `script.validate` the exact version you intend to render. Fix every
   `VALIDATION_ERROR` issue (JSON Pointer + reason). Read warnings against
   `schema.get.warningCodes`; fix real problems and leave intentional layout
   warnings alone.
2. **Optional pre-render visual check** — before paying for a render, you may
   inspect the saved version:
   - Pick 2–3 times from the resolved `timeline`: the first scene after its
     transition (start + ~500ms), the densest cue/line scene, a table/chart/
     flow/composition scene, and the ending.
   - Call `preview.scriptFrame` with `{ scriptVersionId, timeMs }`. It returns
     a full-resolution PNG without creating a version, Job, or Artifact. In MCP
     the picture is an image block; in the CLI use `--out frame.png` to write
     the file and keep stdout small.
   - Look for text overflow, overlapping elements, missing images, table
     clipping and standing-character placement. If you find a real problem,
     fix it with `script.edit` and preview the new version again.
   - Use `preview.assetFrame` when the visual content of an asset matters
     (for example choosing a video frame). Images return their source bytes;
     videos return a PNG at `timeMs`; audio is rejected.
   - The preview is for layout, not final quality. Do not claim that colors,
     motion, or sound are correct. If the call times out, retry once and then
     continue to render; a preview is not part of the acceptance line.
3. `render.start` with `scriptVersionId`. It returns `{ job }` of kind `render`.
   It also accepts an optional `requestId` (§9.1), so a retried render does not
   queue a second Job.
4. Poll `job_wait` / `job.wait` (MCP `kakeai_job_wait`) or `job.get`. A timeout
   (`timedOut: true`) is not a failure; call again with the same job ID.
   A failed job exposes `job.error`. The phase is complete only when
   `status: "succeeded"` **and** `artifacts` contains an Artifact with
   `role: "render"` / `format: "mp4"`. Report its `id`, `durationMs`,
   `widthPx` and `heightPx`. Render output is an Artifact, not an Asset.
5. **Optional post-render visual check** — if you want to inspect the rendered
   picture, fetch stills with `preview.frame` (`artifactId` from `job.get`,
   `timeMs` at the same key moments). Describe what you actually see in each
   frame. If the first call ends in `AGENT_REQUEST_TIMEOUT` on a long video,
   call once more with the same input — the second hit uses the warm
   server-side cache.
6. The human handles the final look and sound check, downloading the MP4, the
   thumbnail, the SRT and the YouTube settings. Do not claim the video is
   correct on their behalf.

## 9. Idempotency, stale bases and timeouts

| Situation | What to do |
| --- | --- |
| Normal edit | Give every `script.edit` a fresh `requestId` that is unique per logical change (for example `<agentId>:<date>-<n>`). |
| Retrying the same edit | Reuse the same `requestId` only when the base and operations are unchanged. A replay returns `replay: true` and creates no new version. |
| `SCRIPT_BASE_STALE` | The base is no longer current. For `script.edit`, `script.get` the current version and re-apply the **same intent** to the new base; reuse the `requestId` only if the failed call created no version (it did not), and use a new one if the operations changed. For `script.save`, omitting `baseScriptVersionId` keeps last-write-wins; when it is given, a mismatch is `SCRIPT_BASE_STALE` — re-read the current version and decide whether the replacement is still wanted. For `script.restore`, the same applies to its optional base guard: re-read `script.listVersions` (`currentScriptVersionId`) and decide whether restoring the old content is still wanted. |
| `IDEMPOTENCY_CONFLICT` | A version with that `requestId` already exists with different input. Never reuse the ID with different content. Read the current version (`script.get` with `languageEditionId`) or the history (`script.listVersions`) and continue from there. |
| `work.create` / `work.clone` timeout | These operations have no `requestId`. After `AGENT_REQUEST_TIMEOUT`, call `work.list` and look for the created Work (same title and `createdAt` at or after your request) or child (`parentWorkId` = the source Work). Retry only when you are sure nothing was created; if several candidates match, ask the human instead of guessing. |
| `script.save` timeout | It has no `requestId`. After `AGENT_REQUEST_TIMEOUT`, call `script.get` / `script.listVersions` to check whether the new version landed, then retry only if it did not. |
| `speaker.add`-only edit timeout | Replaying `script.edit` with the same `requestId` returns the version but an empty `created`. Call `script.get` on that version to find the new Speaker before using it. |
| `AGENT_REQUEST_TIMEOUT` on a mutation | The server may still have applied it. Check state first (`script.get`, `work.list`, `job.list` — pass `{ kind: "tts" }` for TTS Jobs — `asset.list`, `composition.get`) and only then retry. The exceptions are `script.edit` and `script.restore`, which may be replayed immediately with the same `requestId`. |
| `replay: true` | The edit or restore was already applied. Do not apply the operations or restore again. |
| Digest changed mid-session | Re-read `schema.get` and the current script; cached templates and IDs may be stale. A changed `operationDigest` means an operation's input or output shape changed, so re-read that operation's published schema before calling it again. `schemaDigest` also covers each template's input contract, so re-fetch any `template.get` result you cached. |

### 9.1 High-cost operations

`script.edit` and `script.restore` are idempotent by version. The expensive
operations — `tts.create`, `tts.createBulk`, `render.start` and
`composition.publish` — accept an **optional** `requestId` and keep their own
idempotency ledger. `tts.attachBulk` is not in that ledger: its `requestId` is
required and works like `script.edit` (same id returns the existing
ScriptVersion; a different input is `IDEMPOTENCY_CONFLICT`).
A bulk run started without a `requestId` is never recorded and can never be
finalized. A lost TTS Job can be found again with `job.list { kind: "tts" }`,
but the finalization still needs the original `requestId`. `tts.attachBulk`
must be called with the same binding and `agentId` that started the bulk;
another `agentId` is `RESOURCE_NOT_FOUND`.

- Give each of these calls a stable `requestId` that names the logical request
  (for example `render-<workId>-v<versionNumber>` or
  `tts-<scriptVersionId>-<segmentId>`). The same id with the same input returns
  the **same** Job or CompositionVersion instead of creating a second one, so a
  retry after a timeout costs nothing.
- The replay returns the job's **current** state. A job that already succeeded
  comes back as `succeeded` with its `ttsResult`, not as the queued snapshot
  you saw the first time.
- Never reuse one `requestId` for two different inputs. That is reported as
  `IDEMPOTENCY_CONFLICT`: read the existing job or version and continue
  instead of forcing it through.
- `AGENT_IDEMPOTENCY_IN_PROGRESS` means the same request is still running
  somewhere else. Do not retry blindly and do not start a second job: poll
  `job.get` (or `job.wait`) for the running job and use the result.
- A failed call leaves no ledger entry, so the same `requestId` may be used
  again after you fix the cause.
- `composition.publish` with `dryRun: true` has no side effect and is never
  recorded; a dry run and a real publish can share an id.
- Send an `agentId` in the handshake (the MCP and CLI defaults already do).
  Clients without one share one ledger bucket, so their request ids can
  collide with an unrelated client's.

Read timeouts are 10 seconds and mutation timeouts 120 seconds; both are
server-enforced. Job polling has its own bounded budget and is not a mutation
timeout.

## 10. Stable errors

Do not guess at a cause and do not retry blindly. Surface the code and `issues`
to the user when the fix is on their side.

| Code | Meaning / action |
| --- | --- |
| `AGENT_APP_UNAVAILABLE` | Kakeai is not running or its socket is unreachable. Ask the user to start it. |
| `AGENT_OPERATION_UNKNOWN` | The operation is not exposed. Re-read `schema.get` / `operations`; the catalog may have changed. |
| `VALIDATION_ERROR` | Input or saved document violates the contract. Fix the `issues` paths. |
| `EDIT_TARGET_NOT_FOUND` / `EDIT_PRECONDITION_FAILED` / `EDIT_INVALID_INPUT` / `EDIT_UNSUPPORTED_TEMPLATE` | The script or operation is not valid in the current state. Re-read the script and adjust; do not bypass. |
| `SCRIPT_BASE_STALE` | Base version is no longer current (`script.edit`'s base, `script.save`'s optional base guard, or `script.restore`'s optional base guard). Re-read and reapply (see above). |
| `IDEMPOTENCY_CONFLICT` | Same `requestId`, different content. Read the current version and continue; never reuse the ID for other content. |
| `AGENT_IDEMPOTENCY_IN_PROGRESS` | The same `requestId` is still running. Poll the running job with `job.get` / `job_wait` instead of starting a second one. |
| `AGENT_BACKPRESSURE` | Too many in-flight requests on one connection. The request was not executed. Wait briefly, then retry it. |
| `ASSET_UNAVAILABLE` | Referenced asset is missing or not `ready`. Import/wait or pick another. |
| `COMPOSITION_UNAVAILABLE` | Referenced CompositionVersion is not published or its bundle is missing. Publish it first. |
| `TTS_INPUT_INVALID` | Empty text, missing speaker/voice, voice outside the configured adapter, or bad speed. Fix the line or ask the user. |
| `TTS_ENGINE_UNAVAILABLE` | The configured TTS adapter is unreachable. Ask the user to start the engine. |
| `RESOURCE_NOT_FOUND` / `WORK_NOT_FOUND` | The referenced script version, line, asset or work no longer exists, or a `template.get` id/version is not in `schema.get.templates`. Includes a `tts.attachBulk` whose bulk was started by another `agentId` or without a `requestId`. Re-read and re-plan. |
| `AGENT_PAYLOAD_TOO_LARGE` | One request exceeded 32 MiB. Split the work; never inline large media in a script. |
| `JOB_NOT_CANCELLABLE` | Only queued Jobs can be cancelled. A running or terminal Job must be waited for, not cancelled. |
| `RENDER_FAILED` / `RENDER_INPUT_INVALID` | The render Job failed. Report `job.error`; check assets, duration and template inputs. Do not retry identical input indefinitely. |
| `AGENT_PROTOCOL_MISMATCH` | Client/server protocol mismatch. Update the MCP/CLI package; do not work around it. |

## 11. Non-goals

- Deleting Works, Assets, Composition Versions, Artifacts or library entries.
- Publishing anything to an external service (Composition publish inside Kakeai
  is an immutable version, not an external publish).
- Creating, updating, archiving or deleting character library entries, voice
  profiles, face sets, themes, TTS adapters, endpoints or credentials. Existing
  Voice Profiles may be assigned to speakers; libraries themselves stay
  read-only.
- Paid generation other than Jobs on the user's configured TTS adapter.
- Image/video generation, external project import, or editing app-managed
  drafts/bundles on disk.
- Making the final quality judgment (picture, sound, delivery) for the user.
  `preview.scriptFrame` / `preview.assetFrame` / `preview.frame` are optional:
  not checking stills is not a failure, and checking them does not replace the
  human's final review. The human also downloads the MP4 and handles the
  thumbnail, SRT and YouTube settings.

## 12. Related skills

- `kakeai-composition` — author and publish the reusable CompositionVersion that
  a background or device-screen cue references. Call it from this flow when the
  video needs a new motion composition, then reference the published version in
  a `script.edit`.
- `schema.get` — always the authority for templates, fields, warning codes, the
  operation catalog and the contract digests (`schemaDigest`, `operationDigest`).
- `template.get` — the authority for one template's input JSON (`inputSchema`)
  and a valid `example`. Use it instead of guessing nested input shapes.
