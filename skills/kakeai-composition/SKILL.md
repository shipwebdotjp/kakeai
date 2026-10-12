---
name: kakeai-composition
description: >
  Author and publish reusable full-screen motion compositions in Kakeai's Composition Library:
  create a Composition, edit its draft bundle, QA it, publish an immutable CompositionVersion,
  and reference the version from a script via composition.full-bleed@1. Use whenever creating
  or revising a reusable background motion, or when a script needs a published composition version.
---

# Kakeai Composition Library authoring

Kakeai keeps editable HyperFrames projects in a Composition Library. You edit a mutable
**draft**, then explicitly **publish** an immutable **CompositionVersion**. Scripts reference
only published versions by ID through the `composition.full-bleed@1` visual template.
Draft-only changes are invisible to scripts, previews, and render jobs: nothing is recognized
until you publish.

## 0. Connect to the local API

- Base URL: `http://127.0.0.1:4317/api/v1` (`KAKEAI_PORT` overrides `4317`; same value on `localhost` / `[::1]`).
- Every request must send `Host: 127.0.0.1:<port>` (curl does this automatically for that URL).
- `POST` requests must also send `Origin: http://127.0.0.1:<port>` or they are rejected with `403 LOCAL_ACCESS_DENIED`.
- Published bundle files are served from read-only content URLs that require the
  `Kakeai-Media-Session` cookie. The server sets it on any same-origin `GET`, so save it
  first: `curl -c cookies.txt <GET url>`, then reuse with `curl -b cookies.txt <content url>`.
- All JSON bodies must be `Content-Type: application/json`. Responses use a `data` envelope.

## 1. Inspect existing state

- `GET /api/v1/compositions` lists Compositions with their draft status and published versions.
- `GET /api/v1/compositions/:compositionId` shows one Composition, its draft, and every version
  (`id`, `versionNumber`, `bundleHash`, `manifest`).
- `GET /api/v1/compositions/:compositionId/draft/files` returns `{ entrypoint, files }`, so you
  can inspect the seeded `index.html`/`manifest.json` and your own uploads before editing.

The manifest schema lives in `packages/contracts/src/composition.ts`; validation and the default
seed are in `apps/api/src/services/compositions.ts`. You can also read the exact schema from a
draft via the read-back endpoint above.

Never reference a draft from a script. Never edit a published version in place: to revise,
update the draft and publish a new version, then point the script at the new version ID.

## 2. Create a Composition

`POST /api/v1/compositions`:

```json
{ "name": "Soft gradient loop", "runtimeCompositionId": "cmp.motion.gradient-loop" }
```

- `runtimeCompositionId` is stable and unique across Compositions. It must match the manifest.
- Optional `entrypoint` (default `"index.html"`): a bundle-relative path. Absolute paths and
  `..` segments are rejected.
- Creation seeds the draft (`index.html` = a minimal standalone composition; `manifest.json`
  with `contentHash:"draft"`, `entrypoint`, `runtimeCompositionId`, `width:1920`, `height:1080`,
  `durationMs:5000`, `dependencies:[]`).

## 3. Edit the draft bundle

`POST /api/v1/compositions/:compositionId/draft`:

```json
{
  "entrypoint": "index.html",
  "files": {
    "index.html": "<!doctype html>...",
    "vendor/gsap.min.js": "...",
    "manifest.json": "{...}"
  }
}
```

- `files` keys are bundle-relative paths; absolute paths and `..` are rejected. Parent
  directories are created as needed. This is a **partial update**: only the files you send are
  written; the rest (including the seed) stay. Read the current set first with
  `GET …/draft/files` if you need to see what is there.
- Instead of hand-writing `manifest.json`, pass a `manifest` object
  (`{ "durationMs"?: number, "dependencies"?: string[] }`) and the server writes `manifest.json`
  for you, filling `entrypoint`/`runtimeCompositionId`/`width`/`height`/`contentHash`. Direct
  `files["manifest.json"]` still works.
- Errors are structured (see below); validate with a dry-run before the real publish.

### `manifest.json` — exact, strict schema

`compositionManifestSchema` is a Zod `strictObject` (extra keys rejected). You normally do not
write this by hand — use the `manifest` field of the draft update — but this is the exact shape:

```json
{
  "entrypoint": "index.html",
  "contentHash": "draft",
  "runtimeCompositionId": "cmp.news.trump-si-3reasons",
  "width": 1920,
  "height": 1080,
  "durationMs": 10000,
  "dependencies": ["vendor/gsap.min.js"]
}
```

- `width`/`height` are literals `1920`/`1080`; `durationMs` is a positive integer (ms).
- `contentHash` is **optional** and not validated — the server computes `bundleHash` itself.
- Every `dependencies` entry must exist as a file in the bundle, or publish fails.

### Entry form — author a **standalone** composition

Write the entry as a normal standalone HyperFrames document (root `data-composition-id` directly
in `<body>`, `<style>` in `<head>`) — **not** a `<template>` wrapper. Kakeai embeds it via
`data-composition-src` and its compiler accepts the plain document, keeping the `<head>`. A
`<template>` form drops `<head>` `<style>`/`<script>` at compile time (they are discarded), and is
only worth using for genuinely nested assets. The root's `data-composition-id` **must equal the
runtime `runtimeCompositionId`**, and the same id is the `window.__timelines[...]` key.

### Authoring constraints (bundle v1, enforced)

- 1920x1080 full-screen motion only; finite positive `durationMs`; output fps is 30.
- **No audio**: `<audio>`, `<bgsound>`, or audio `<source>` is rejected outright.
- **No external URLs / network-fetched dependencies.** Vendor libraries into the bundle (this
  project keeps `vendor/gsap.min.js`) and list them in `dependencies`. The scaffold's
  jsdelivr CDN `<script>` is fine for local preview but is a hard fail as a bundle dependency.
  Reference vendored files with a path relative to the entry (`src="vendor/gsap.min.js"`); the
  compiler rewrites it against the bundle directory, so the same relative path works locally.
- Prefer an external `<script src>` over inlining library source: inline `<script>` bodies are
  wrapped by the scoped-composition runtime, which can break a big minified library.
- **Fonts must be `@hyperframes` auto-resolved families** (e.g. `Noto Sans JP`, `Inter`) or
  declared with an in-bundle `@font-face`. Unknown named fonts (`Hiragino Sans`, `Yu Gothic`, …)
  hard-fail lint with `font_family_without_font_face`. For Japanese use
  `font-family: "Noto Sans JP", sans-serif;` — it is fetched and embedded deterministically at
  compile time.

### Root sizing after mount (the stripped inner root)

When the host's `data-composition-id` equals the inner root's, the compiler **strips the inner
root** and injects its children into the host, so `#root{…}` CSS and inline styles on the root are
lost. Make the root's sizing self-sufficient instead: wrap all content in one `.stage`
`position:absolute; inset:0` child. The Kakeai host carries `class="kakeai-fullbleed"`
(`position:absolute; inset:0; width/height:100%`), so `.stage` fills it either way.

## 4. QA before publish

Run the normal HyperFrames composition QA on the entry **before** publishing:

- `npx hyperframes check` — lint + runtime + layout + motion + contrast in one command. Clear
  every lint **error** first: an error switches off the layout and contrast audits, so a "clean"
  report with a lint error is meaningless.
- Visual pass: `npx hyperframes snapshot --at 0.5,3.6,6.7,9.8 --no-end -o snapshots` and eyeball
  the contact sheet.
- Deliberate decorative bleed (glows, oversized grid) raises `container_overflow` layout
  warnings; mark those elements `data-layout-allow-overflow` rather than shrinking them.
- **Verify the real embed path**, not just the standalone entry. Make a throwaway host that mirrors
  the compiler's markup — `<div class="kakeai-fullbleed" data-composition-id="<runtimeId>"
  data-composition-src="compositions/<file>.html" data-start="0" data-duration="<s>">` inside a
  1920x1080 root, with the composition copied under `compositions/` and its vendored deps next to
  it — then `check` + `snapshot`. This exercises sub-composition inlining (CSS scoping, the
  stripped inner root, relative dependency rewriting) that a standalone preview does not. Delete
  the harness afterwards.
- The server re-runs the HyperFrames lint at publish time and rejects bundles with lint errors
  (warnings allowed), but do not rely on it as your only check.

## 5. Publish

Dry-run first — this runs the exact publish validation without creating a version:

```
POST /api/v1/compositions/:compositionId/publish?dryRun=true   body: {"entrypoint"?: "..."}
```

On success it returns `200 { "manifest": {...} }`. On failure it returns `422 VALIDATION_ERROR`
with `details.issues[]`, each `{ path, code, message }` (e.g. `manifest`/`entrypoint`/`dependencies`
paths; codes like `external_url`, `composition_id_mismatch`, `missing_dependency`, and lint codes).
Fix every issue and re-run until clean.

Then publish for real:

```
POST /api/v1/compositions/:compositionId/publish   body: {"entrypoint"?: "..."}
```

Publish validates entrypoint existence, manifest match, `runtimeCompositionId` match, 1920x1080,
finite `durationMs`, in-bundle dependencies, no external URLs, matching entry
`data-composition-id`, no audio, and no HyperFrames lint errors, then copies the draft to an
immutable bundle and returns the new `CompositionVersion` (`id`, `versionNumber`, `bundleHash`,
`storageKey`, `manifest`). Failures use the same `422 VALIDATION_ERROR` `details.issues` shape as
the dry-run.

Re-publishing an unchanged draft creates a new version number with identical content.
Published versions are never modified or deleted while referenced.

## 6. Reference the version from a script

Add one visual cue per Scene background:

```json
{
  "template": { "id": "composition.full-bleed", "version": 1 },
  "range": { "kind": "scene" },
  "layer": "background",
  "input": { "compositionVersionId": "<version id>" }
}
```

Rules enforced at script save: `range` must be `scene`, `layer` must be `background`,
and the same CompositionVersion ID may appear only once per ScriptVersion.

## 7. Verify end to end

- Content URL: `GET /api/v1/compositions/versions/:versionId/content/index.html`
  renders the published entrypoint; subpaths resolve bundle-relative dependencies. Path
  traversal outside the bundle is denied.
- The content URL requires the `Kakeai-Media-Session` cookie: a bare first GET returns **403**
  with a tiny body. Establish the cookie first, then reuse it — e.g.
  `curl -s -c cookies.txt <url>/index.html`, then `curl -s -b cookies.txt <url>/index.html`,
  `curl -s -b cookies.txt <url>/vendor/gsap.min.js`, `curl -s -b cookies.txt <url>/manifest.json`.
- Save a ScriptVersion referencing the version, run saved and draft previews, then create
  a render job: the job snapshot pins the version ID, bundle hash, and manifest.

## Practice notes (learned the hard way)

- The published bundle's `index.html` is the standalone composition, but production use is as a
  `composition.full-bleed@1` background: the real render path is the **compiler** (sub-composition
  inlining), which differs from the local **runtime loader** used by preview. Test both.
- The scaffold pins `hyperframes@<version>`; keep using the pinned CLI for QA so renders stay
  reproducible. `npx hyperframes usage --json` may return `status: unknown`
  (`unsupported_harness`) in this harness — report usage as unknown, never guess it.
- Worked reference: composition `cmp.news.trump-si-3reasons` (10s Japanese infographic,
  `vendor/gsap.min.js` dependency) — v1 published via the draft→publish flow above.

## Do not

- Import external projects or hand-written third-party HTML into the library.
- Write raw HTML into `ScriptVersion.contentJson`; scripts carry only the version ID.
- Use absolute filesystem paths anywhere (API inputs, manifest, bundle files).
- Treat `storageKey` as stable API: it is a server-side relative path, not a reference.
