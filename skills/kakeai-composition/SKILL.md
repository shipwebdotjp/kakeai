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
- Creation seeds the draft with a default `index.html` and `manifest.json`.

## 3. Edit the draft bundle

`POST /api/v1/compositions/:compositionId/draft`:

```json
{
  "entrypoint": "index.html",
  "files": {
    "index.html": "<!doctype html>...",
    "style.css": "..."
  }
}
```

- `files` keys are bundle-relative paths; absolute paths and `..` are rejected.
- Parent directories are created as needed. `manifest.json` is part of the draft: keep it
  in sync (entrypoint, `runtimeCompositionId`, width, height, `durationMs`, `dependencies`).
- Bundle contract (v1): 1920x1080 full-screen motion only, finite positive `durationMs`,
  no audio elements or tracks, no external URLs, no absolute paths, no network-fetched
  dependencies. Every `dependencies` entry must exist inside the bundle.

## 4. QA before publish

Per project spec, pass the normal HyperFrames composition QA and preview before publishing:

- Lint the entry HTML with the HyperFrames lint (`/hyperframes-cli`). Fix errors; warnings are acceptable.
- Fetch the draft `index.html` (via the draft on disk is not exposed over HTTP; verify by
  publishing to a throwaway Composition or by rendering locally) and confirm 1920x1080,
  silence, and no external references.

## 5. Publish

`POST /api/v1/compositions/:compositionId/publish` with optional `{"entrypoint": "..."}`.
Publish validates entrypoint, manifest match, `runtimeCompositionId` match, 1920x1080,
finite `durationMs`, no audio, and in-bundle dependencies, then copies the draft to an
immutable bundle and returns the new `CompositionVersion` (`id`, `versionNumber`,
`bundleHash`, `storageKey`, `manifest`).

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
  (media-session cookie required) renders the published entrypoint; subpaths resolve
  bundle-relative dependencies. Path traversal outside the bundle is denied.
- Save a ScriptVersion referencing the version, run saved and draft previews, then create
  a render job: the job snapshot pins the version ID, bundle hash, and manifest.

## Do not

- Import external projects or hand-written third-party HTML into the library.
- Write raw HTML into `ScriptVersion.contentJson`; scripts carry only the version ID.
- Use absolute filesystem paths anywhere (API inputs, manifest, bundle files).
- Treat `storageKey` as stable API: it is a server-side relative path, not a reference.
