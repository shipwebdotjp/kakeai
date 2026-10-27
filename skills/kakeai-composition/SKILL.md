---
name: kakeai-composition
description: >
  Author and publish a reusable full-screen motion Composition in Kakeai's
  Composition Library through Agent Access (MCP kakeai_composition_* tools or
  kakeai-agent CLI): read/create a Composition, edit its draft bundle, QA it,
  dry-run and publish an immutable CompositionVersion, then reference it from a
  script. Use when a video needs a reusable background or device-screen motion.
  For producing a whole video, start with kakeai-production.
---

# Kakeai Composition Library authoring

Kakeai keeps editable HyperFrames projects in a Composition Library. You edit a
mutable **draft**, then explicitly **publish** an immutable
**CompositionVersion**. Scripts reference only published versions by ID through
the `composition.full-bleed@1` visual template. Draft-only changes are invisible
to scripts, previews, and render jobs: nothing is recognized until you publish.

When the target Visual Theme uses a Visual Skin, the server also gives you a
**Style Kit** (`kakeai-style/` in the draft) through the Composition Authoring
Context, so your composition shares the theme's colors, typography, and world
view. Kit files are protected: publish verifies their hashes and rejects any
change with `STYLE_KIT_MODIFIED`.

## 0. Before you start

- For a full video (script, characters, assets, TTS, render), use the
  `kakeai-production` skill first and come back here only when it needs a new
  reusable composition. This skill covers the CompositionVersion itself.
- Use Agent Access only: the MCP `kakeai_composition_*` tools or the
  `kakeai-agent` CLI. Do not call Kakeai's HTTP API, the local socket, Prisma, or
  the app data directories directly.
- Read draft content and write it **only** through `composition.draft.get` and
  `composition.draft.update`. `drafts/` and `bundles/` are app-managed mirrors;
  editing them on disk is invisible to Kakeai and can corrupt the bundle.

Operation names are canonical; the MCP tool and CLI forms are just bindings.

| Operation | MCP tool | CLI |
| --- | --- | --- |
| `composition.list` | `kakeai_composition_list` | `kakeai-agent composition.list` |
| `composition.get` | `kakeai_composition_get` | `kakeai-agent composition.get --input '{"compositionId":"..."}'` |
| `composition.draft.get` | `kakeai_composition_draft_get` | `kakeai-agent composition.draft.get --input '{"compositionId":"..."}'` |
| `composition.authoringContext` | `kakeai_composition_authoring_context` | `kakeai-agent composition.authoringContext --input '...'` |
| `composition.create` | `kakeai_composition_create` | `kakeai-agent composition.create --input '...'` |
| `composition.draft.update` | `kakeai_composition_draft_save` | `kakeai-agent composition.draft.update --input '...'` |
| `composition.publish` | `kakeai_composition_publish` | `kakeai-agent composition.publish --input '...'` |

Example shape: `kakeai-agent composition.list` returns `{ compositions }`;
`composition.get` returns `{ composition }` with its draft and versions.
Input fields are validated against the operation contracts; read them from the
MCP `inputSchema` or the CLI's validation rather than from memory.

## 1. Inspect existing state

- `composition.list` lists Compositions with their draft status and published
  versions.
- `composition.get` shows one Composition, its draft, and every version
  (`id`, `versionNumber`, `bundleHash`, `manifest`, `styleProvenance`).
- `composition.draft.get` returns `{ draft }` with `entrypoint`, `files`
  (UTF-8 text, including `manifest.json`) and `binaryFiles` (base64), so you can
  inspect the seeded `index.html`, an existing `kakeai-style/` Style Kit, and
  your own uploads before editing.
- Composition responses include `styleProvenance`: `authored` (a Style Kit was
  seeded), `neutral` (no skin authoring), or `legacy` (pre-Style-Kit version). It
  is read-only history.

Never reference a draft from a script. Never edit a published version in place:
to revise, update the draft and publish a new version, then point the script at
the new version ID.

## 2. Create a Composition

Call `composition.create` with `name`, a stable unique `runtimeCompositionId`,
and optional `entrypoint`, `canvasProfile`, and `authoringStyle`.

- `runtimeCompositionId` is stable and unique across Compositions. It must match
  the manifest and the entry root.
- Optional `canvasProfile` (`"landscape"` default, or `"portrait"`): the fixed
  internal canvas. `landscape` is 1920×1080; `portrait` is 1080×1920. It is
  immutable per published version, so a single Composition can publish both. The
  final render stays 1920×1080; the profile only sizes the nested composition's
  own canvas.
- Optional `entrypoint` (default `"index.html"`): a bundle-relative path.
  Absolute paths and `..` segments are rejected.
- Creation seeds the draft (`index.html` = a minimal standalone composition with
  the profile's `data-width`/`data-height`; `manifest.json` with
  `contentHash:"draft"`, `entrypoint`, `runtimeCompositionId`, `canvasProfile`,
  the profile dimensions, `durationMs:5000`, `dependencies:[]`). The seed is
  written to `<dataRoot>/compositions/drafts/<compositionId>/` immediately.

### Visual Skin authoring (`authoringStyle`)

When the script's theme uses a Visual Skin, resolve the **Composition Authoring
Context** *before* creating the composition:

```
kakeai-agent composition.authoringContext --input '{
  "visualTheme": { "id": "theme_...", "version": 3 },
  "canvasProfile": "landscape"
}'
```

The response `{ context }` is the non-persistent authoring input. It contains
`contextSchemaVersion`, the resolved theme ref + `definitionHash`, `skin`, the
Style Kit `version`/`hash`, `canvasProfile`, a `brief` (`intent`, `must`,
`avoid`), `fontDiagnostics`, and `seed.styleDirectory` (`kakeai-style/`).

- Only **published** Theme Revisions resolve; drafts, archived themes, and
  unknown refs are `VALIDATION_ERROR`. Resolving writes nothing, and the same
  inputs always return the same `kit.hash`.
- Respect `brief.must` / `brief.avoid` and read `STYLE.md` before authoring.

Then create the Composition with the same theme so the draft is seeded with the
Style Kit:

```json
{
  "name": "Paper notes intro",
  "runtimeCompositionId": "cmp.motion.paper-notes",
  "authoringStyle": { "visualTheme": { "id": "theme_...", "version": 3 } }
}
```

`authoringStyle` carries only the theme ref. Set the top-level `canvasProfile` as
well if the composition should use a non-default profile; the server resolves the
context with that profile and seeds the Style Kit and manifest accordingly. The
server re-resolves the same context and writes `kakeai-style/` (`STYLE.md`,
`tokens.css`, `fonts.css`, `components.css`, `kit-lock.json`) next to the minimal
entry.

## 3. Edit the draft bundle

`composition.draft.update` takes `compositionId` plus the draft update:
`entrypoint` (optional), `files`, `filesBase64`, and `manifest`.

```json
{
  "compositionId": "cmp_123",
  "files": {
    "index.html": "<!doctype html>...",
    "vendor/gsap.min.js": "..."
  },
  "filesBase64": {
    "assets/photo.png": "iVBORw0KGgo..."
  },
  "manifest": { "durationMs": 10000, "dependencies": ["vendor/gsap.min.js", "assets/photo.png"] }
}
```

- `files` keys are bundle-relative paths; absolute paths and `..` are rejected.
  Parent directories are created as needed. This is a **partial update**: only
  the files you send are written; the rest (including the seed) stay. Read the
  current set first with `composition.draft.get`.
- `files` values are UTF-8 text. `filesBase64` values are base64 strings for
  **binary** files (images, etc.); the server decodes and writes the bytes. The
  same normalized path must not appear in both `files` and `filesBase64`.
- Instead of hand-writing `manifest.json`, pass the `manifest` object
  (`durationMs`, `dependencies`, `canvasProfile`) and the server writes
  `manifest.json` for you, filling `entrypoint`/`runtimeCompositionId`/`width`/
  `height`/`contentHash`. `canvasProfile` defaults to the draft's current
  profile, or `landscape` if none. Writing `files["manifest.json"]` still works.
- The response `{ draft }` is draft metadata (`entrypoint`, `storageKey`,
  `updatedAt`), not the file map; use `composition.draft.get` to read back.
- Errors are structured (`VALIDATION_ERROR` with `issues`). Validate with a
  dry-run publish before the real publish.

### Style Kit rules (when `kakeai-style/` exists)

- Read `STYLE.md`, `tokens.css`, `fonts.css`, `kit-lock.json` first; `STYLE.md`
  defines the world view, must/avoid rules, and readability/motion principles.
- `kakeai-style/` is **protected**: never send changes under that prefix (the
  server rejects them with `STYLE_KIT_MODIFIED`) and never edit those files on
  disk. Put your own CSS, SVG, and images in `assets/` or your own namespace,
  not in `kakeai-style/`.
- Link the kit from the entry (`<link rel="stylesheet" href="kakeai-style/tokens.css">`
  plus `fonts.css` and `components.css`) and list every linked file in the
  manifest `dependencies`. Use the `tokens.css` CSS variables for colors, radii,
  shadows, and motion.
- **Fonts**: use only the `var(--kakeai-font-*)` aliases from `fonts.css`
  (verified `@font-face { src: local(...) }`). Never write raw family names or
  the theme's font names — HyperFrames lint rejects named families without
  `@font-face`. Wait for `document.fonts.ready` before text measurement and
  timeline registration.
- `fontDiagnostics` lists which local faces resolved; entries that fell back to a
  generic stack render with the theme's fallback, not the selected face. Do not
  try to fix this by embedding font files.
- Use the kit components (for `handmade-paper@1`: `.kk-paper`, `.kk-paper-torn`,
  `.kk-tape`, `.kk-note`) instead of re-drawing the world view yourself.

### Binary assets (images)

The draft operation takes JSON, so binary files go in `filesBase64` as base64
strings — not in `files`. Do **not** inline images as `data:` URIs in
`index.html`: it bloats the entry (hundreds of KB), makes hand-editing
impossible, and forces a build script. Send each image as its own bundle file.

- Reference it from the entry by bundle-relative path
  (`<img src="assets/photo.png">`); the compiler/runtime resolves it against the
  bundle.
- Text assets (HTML/CSS/JS/JSON, and vendored `vendor/*.js`) go in `files` as
  plain strings; only true binaries need `filesBase64`. Note this asymmetry when
  planning.
- Keep total draft size in mind (server caps: 256 files, 4 MB per file, 16 MB
  total). Base64 adds ~33%, and one Agent Access request is capped at 32 MiB, so
  keep individual binaries well under that.
- Read-back returns binaries under `binaryFiles` (base64), so round-trips are
  lossless.

### `manifest.json` rules

The manifest is a strict object; publish validates it. You normally do not write
it by hand — use the `manifest` field of `composition.draft.update` — but it is the
same file in the bundle.

- It carries bundle-relative `entrypoint`, `contentHash`, `runtimeCompositionId`,
  optional `canvasProfile`, fixed `width`/`height`, positive integer
  `durationMs`, and a `dependencies` array.
- `canvasProfile` is optional (`"landscape"` or `"portrait"`); omitted resolves
  as `landscape`. `width`/`height` must equal the profile's fixed dimensions
  (`landscape` 1920×1080, `portrait` 1080×1920). Arbitrary sizes and
  profile/dimension mismatches are rejected.
- `contentHash` is optional and not validated — the server computes `bundleHash`
  itself. On publish the server sets the stored/returned `manifest.contentHash`
  to the real `bundleHash` (the `manifest.json` inside the bundle still says
  `"draft"`; trust the returned `bundleHash`).
- Every `dependencies` entry must exist as a file in the bundle, or publish
  fails. Binary files may be listed too.

### Entry form — author a **standalone** composition

Write the entry as a normal standalone HyperFrames document (root
`data-composition-id` directly in `<body>`, `<style>` in `<head>`) — **not** a
`<template>` wrapper. Kakeai embeds it via `data-composition-src` and its
compiler accepts the plain document, keeping the `<head>`. A `<template>` form
drops `<head>` `<style>`/`<script>` at compile time (they are discarded), and is
only worth using for genuinely nested assets. The root's `data-composition-id`
**must equal the runtime `runtimeCompositionId`**, and the same id is the
`window.__timelines[...]` key.

### Authoring constraints (bundle v1, enforced)

- Full-screen motion in one of the fixed Canvas Profiles: `landscape` (1920×1080)
  or `portrait` (1080×1920); finite positive `durationMs`; output fps is 30. The
  root's `data-width`/`data-height` must match the manifest's profile dimensions
  exactly.
- **No audio**: `<audio>`, `<bgsound>`, or audio `<source>` is rejected outright.
- **No external URLs / network-fetched dependencies.** Vendor libraries into the
  bundle (this project keeps `vendor/gsap.min.js`) and list them in
  `dependencies`. The scaffold's jsdelivr CDN `<script>` is fine for local
  preview but is a hard fail as a bundle dependency. Reference vendored files
  with a path relative to the entry (`src="vendor/gsap.min.js"`); the compiler
  rewrites it against the bundle directory, so the same relative path works
  locally.
- Prefer an external `<script src>` over inlining library source: inline
  `<script>` bodies are wrapped by the scoped-composition runtime, which can
  break a big minified library.
- **Fonts must be `@hyperframes` auto-resolved families** (e.g. `Noto Sans JP`,
  `Inter`) or declared with an in-bundle `@font-face`. Unknown named fonts
  (`Hiragino Sans`, `Yu Gothic`, …) hard-fail lint with
  `font_family_without_font_face`. For Japanese use
  `font-family: "Noto Sans JP", sans-serif;` — it is fetched and embedded
  deterministically at compile time.

### Root sizing after mount (the stripped inner root)

When the host's `data-composition-id` equals the inner root's, the compiler
**strips the inner root** and injects its children into the host, so `#root{…}`
CSS and inline styles on the root are lost. Make the root's sizing
self-sufficient instead: wrap all content in one `.stage`
`position:absolute; inset:0` child. The Kakeai host carries
`class="kakeai-fullbleed"` (`position:absolute; inset:0; width/height:100%`), so
`.stage` fills it either way.

## 4. QA before publish

Run the normal HyperFrames composition QA on the entry **before** publishing:

- `npx hyperframes check` — lint + runtime + layout + motion + contrast in one
  command. Clear every lint **error** first: an error switches off the layout and
  contrast audits, so a "clean" report with a lint error is meaningless.
- Visual pass: `npx hyperframes snapshot --at 0.5,3.6,6.7,9.8 --no-end -o snapshots`
  and eyeball the contact sheet.
- Deliberate decorative bleed (glows, oversized grid) raises
  `container_overflow` layout warnings; mark those elements
  `data-layout-allow-overflow` rather than shrinking them.
- Other intentional-layout escape hatches: `data-layout-ignore` (exclude an
  element from layout audits), `data-layout-allow-caption-zone` (intentional
  lower-third copy). For overlap/occlusion and any others, read the exact
  attribute name from the `check` finding's `fixHint` and the HyperFrames
  `data-attributes` reference rather than guessing. Prefer the narrowest opt-out.
- `check`/`snapshot` take a project **directory** and use that directory's
  `index.html` as the entry; Kakeai's `drafts/` and `bundles/` are app-managed
  and are not your QA target. Run them against your source folder (see Folder
  workflow).
- **Verify the real embed path**, not just the standalone entry. Make a throwaway
  host that mirrors the compiler's markup — `<div class="kakeai-fullbleed"
  data-composition-id="<runtimeId>" data-composition-src="compositions/<file>.html"
  data-start="0" data-duration="<s>">` inside a 1920x1080 root, with the
  composition copied under `compositions/` and its vendored deps next to it —
  then `check` + `snapshot`. This exercises sub-composition inlining (CSS
  scoping, the stripped inner root, relative dependency rewriting) that a
  standalone preview does not. Delete the harness afterwards.
- The server re-runs the HyperFrames lint at publish time and rejects bundles
  with lint errors (warnings allowed), but do not rely on it as your only check.
- Style QA with a kit: confirm every `kakeai-style/` file is byte-identical to the
  seed (never edited), the entry references the kit through `kakeai-style/…`
  paths, fonts use `var(--kakeai-font-*)`, and the result follows `STYLE.md`'s
  must/avoid rules. Dry-run publish verifies the kit hashes and fails with
  `STYLE_KIT_MODIFIED` on any change.

## 5. Publish

Dry-run first — this runs the exact publish validation without creating a
version:

```
kakeai-agent composition.publish --input '{"compositionId":"cmp_123","dryRun":true}'
```

On success it returns `{ dryRun: true, manifest, fontDiagnostics }`. On failure it
returns `VALIDATION_ERROR` with `issues[]`, each `{ path, code, message }` (e.g.
`manifest`/`entrypoint`/`dependencies` paths; codes like `external_url`,
`composition_id_mismatch`, `missing_dependency`, and lint codes). Fix every issue
and re-run until clean.

Then publish for real by omitting `dryRun` (or passing `false`):

```
kakeai-agent composition.publish --input '{"compositionId":"cmp_123"}'
```

It returns `{ dryRun: false, version, fontDiagnostics }`. Publish validates
entrypoint existence, manifest match, `runtimeCompositionId` match, manifest
dimensions against the Canvas Profile, entry root `data-width`/`data-height`
against the manifest, finite `durationMs`, in-bundle dependencies, no external
URLs, matching entry `data-composition-id`, no audio, and no HyperFrames lint
errors, then copies the draft to an immutable bundle and returns the new
`CompositionVersion` (`id`, `versionNumber`, `bundleHash`, `storageKey`,
`manifest`, `styleProvenance`). Failures use the same `VALIDATION_ERROR`
`issues` shape as the dry-run.

When the draft has a Style Kit, publish additionally verifies every protected
file and the `kit-lock.json` against the seeded hashes and rejects tampering with
`STYLE_KIT_MODIFIED` (`issues` lists the modified/missing/extra paths). The
published `styleProvenance` pins the authoring Theme ref and definition hash, Skin
ref, kit hash, and font diagnostics; it never follows later theme or skin
changes.

Re-publishing an unchanged draft creates a new version number with identical
content. Published versions are never modified or deleted while referenced.

`composition.publish` accepts an optional `requestId`. Give a real publish a
stable id (for example `publish-<compositionId>-v<draftRevision>`): a retry
with the same id and the same input returns the version that already exists
instead of creating a second one, and the same id with a different input is
rejected with `IDEMPOTENCY_CONFLICT`. A dry run is never recorded, so it does
not consume the id.

## 6. Reference the version from a script

Add one visual cue per Scene background with `script.edit` (the same operation
the `kakeai-production` skill uses), referencing the published version ID:

```json
{
  "baseScriptVersionId": "<current version>",
  "requestId": "<unique>",
  "operations": [
    {
      "op": "cue.add",
      "sceneId": "<scene id>",
      "template": { "id": "composition.full-bleed", "version": 1 },
      "range": { "kind": "scene" },
      "layer": "background",
      "input": { "compositionVersionId": "<version id>" }
    }
  ]
}
```

Read the exact template fields from `schema.get`; do not infer them. For the
input JSON itself, call `template.get` with the template `id`/`version` and use
its `inputSchema` and `example`. `schema.get` also returns `schemaDigest` and
`operationDigest`; if either differs from what you recorded earlier, re-read
`schema.get` and any cached `template.get` result before publishing or editing a
draft.

Rules enforced at script save: `layer` must be `background` (`scene` / `lines` /
`offset` ranges are all allowed). The same CompositionVersion may be referenced
any number of times in one ScriptVersion: HyperFrames scopes each
nested-composition instance (runtime composition ID, CSS, DOM lookups, timeline
registration, SVG ids), so there is no one-reference limit.

- **Background placement is background-only.** You cannot put a
  `composition.full-bleed` cue on `card`/`overlay`/`standing` layers — script
  save rejects it. It also accepts only `landscape` Canvas Profile versions; a
  `portrait` version is rejected at save, draft preview, preview, and render. To
  place a composition inside a device screen, use `scene.device-frame@1` and set
  its `screen` to a `composition` nested visual (version ID plus
  `fit: "contain" | "cover"`, optional `zoom` and `position`). Both Canvas
  Profiles work in a device screen; the `phone` frame is 9:16, so a `portrait`
  composition fits it at `contain`. Other composite templates (site mockup, TV,
  custom bezels) can gain a composition slot later.
- **Nested device-screen composition timing.** The child plays from 0 at the cue
  start and is hidden at its own `durationMs` (no last-frame hold, no loop).
  Cue/Scene crossfade only changes the parent device frame's visibility; the
  child clock is not reset.
- **Effective window is `min(range, manifest.durationMs)`.** A cue longer than
  the child is cut off at the child end (no last-frame hold, no loop). Cue
  transitions must fit inside the effective window. If a Scene crossfade needs a
  longer window than the child, save and render reject it — make the composition
  longer or the crossfade shorter.

## 7. Verify end to end

- Read back the draft (`composition.draft.get`) and confirm the files you pushed
  are the ones you expect.
- Dry-run, then publish. A real publish returns the new version ID and
  `bundleHash`; keep both.
- Add the reference cue through `script.edit`, then run `script.validate` on the
  resulting version. It returns `warnings` and the resolved `timeline`; the
  CompositionVersion must be published and its bundle complete.
- Create a render job with `render.start`: the job snapshot pins the version ID,
  bundle hash, and manifest. Wait with `job_wait` / `job.wait`.
- Visual quality of the rendered video is the user's call; this skill does not
  autonomously judge preview or render appearance.

## Storage layout (what Kakeai writes)

Kakeai's data root (macOS: `~/Library/Application Support/Kakeai`) holds
`compositions/`. Your working directory when authoring is typically
`<dataRoot>/compositions`, but the app-managed subdirectories are off limits.

- `composition.create` **immediately** writes `drafts/<compositionId>/` with the
  seed `index.html` and `manifest.json`.
- Each `composition.draft.update` overwrites only the files you send in that draft
  directory.
- `composition.publish` copies the draft to `bundles/<contentHash>/<versionId>/`.

`drafts/` and `bundles/` are server-managed mirrors — never edit them directly
and never read them as the source of truth. Edit your own source folder and push
via `composition.draft.update`; read state via `composition.draft.get`. Past
versions persist; the local "open canvas" is a single root `index.html`.

## HyperFrames relationship

- The destination is Kakeai: publish a CompositionVersion and preview it in the
  Kakeai app. Do **not** drive the final check through HyperFrames Studio preview
  or `render`; those are not part of the Kakeai flow.
- Write the entry as a standalone document. The generic HyperFrames guidance to
  wrap `data-composition-src` sub-compositions in `<template>` does **not** apply
  to Kakeai bundles (Kakeai lints the entry as a standalone composition and keeps
  `<head>`).
- `npx hyperframes usage --json` may report `status: unknown`
  (`unsupported_harness`) here — that is expected; report usage as unknown and
  continue.

## Folder workflow (multiple compositions)

One composition = one self-contained source folder; keep the app's root
`index.html` as the single "open canvas":

```
compositions/
  index.html                 # app's active canvas (Kakeai may overwrite)
  src/
    <slug>/                  # author here
      index.html             # standalone entry
      vendor/gsap.min.js     # self-contained deps (do not use ../vendor)
      assets/                # source images
  drafts/<id>/  bundles/<hash>/<versionId>/   # Kakeai-managed, do not touch
```

- QA with `npx hyperframes check src/<slug>` (the CLI uses that folder's
  `index.html`).
- Push by sending a `files`/`filesBase64` map with bundle-relative paths; disk
  layout is irrelevant to the operation. Dependencies must live inside the bundle
  you send (`../vendor` fails publish with a dependency mismatch), so duplicate
  shared deps per source folder.

## Starter template

A minimal, lint-clean starter lives next to this skill at `templates/starter/`: a
standalone entry with a `.stage` wrapper, `Noto Sans JP`, a vendored
`vendor/gsap.min.js` plus an example `manifest.json`. Copy it into `src/<slug>/`,
replace `cmp.motion.starter` with your `runtimeCompositionId` (in both the entry's
`data-composition-id`/`window.__timelines` key and `manifest.json`), and build
from there instead of starting from zero.

## Practice notes (learned the hard way)

- The published bundle's `index.html` is the standalone composition, but
  production use is as a `composition.full-bleed@1` background: the real render
  path is the **compiler** (sub-composition inlining), which differs from the
  local **runtime loader** used by preview. Test both.
- The scaffold pins `hyperframes@<version>`; keep using the pinned CLI for QA so
  renders stay reproducible. `npx hyperframes usage --json` may return
  `status: unknown` (`unsupported_harness`) in this harness — report usage as
  unknown, never guess it.
- Worked reference: composition `cmp.news.trump-si-3reasons` (10s Japanese
  infographic, `vendor/gsap.min.js` dependency) — v1 published via the
  draft→publish flow above.

## Do not

- Import external projects or hand-written third-party HTML into the library.
- Write raw HTML into `ScriptVersion.contentJson`; scripts carry only the version
  ID.
- Use absolute filesystem paths anywhere (operation inputs, manifest, bundle
  files).
- Treat `storageKey` as stable API: it is a server-side relative path, not a
  reference.
