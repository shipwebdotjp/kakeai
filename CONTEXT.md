# Kakeai

Kakeai is a video-production context. It keeps editorial intent separate from rendered media so that a work can be revised, localized, and rendered reproducibly.

## Language

**Work**:
A parent creative work that groups its language editions and derived works.
_Avoid_: Project, video

**Language Edition**:
A version of a Work made for one locale.
_Avoid_: Translation, locale

**Script Version**:
An immutable version of the editorial structure for one Language Edition.
_Avoid_: Composition HTML, timeline

**Script Version Restore**:
Creating a new Script Version from an earlier version's content, recording the
earlier version as its source. The earlier version is never modified.
_Avoid_: rollback, undo

**Version Author**:
The user or Agent recorded as the creator of a Script Version, used to identify and revert AI-authored revisions.
_Avoid_: owner, editor

**Agent**:
An external, user-controlled AI client that operates Kakeai through the app's local agent interface.
_Avoid_: bot, LLM, model

**MCP Binding**:
The MCP stdio surface through which a coding agent calls Agent Access operations. It forwards operations and holds no Kakeai business logic.
_Avoid_: plugin, server API

**CLI Binding**:
The `kakeai-agent` command surface through which a user or agent calls Agent Access operations from a shell. It shares the MCP Binding's client, validation and job polling, and holds no Kakeai business logic.
_Avoid_: admin command, shell API

**Production Skill**:
A packaged workflow that tells an external agent the order and decision points for producing a Kakeai video through Agent Access, while treating the live schema and operation contracts as authoritative rather than duplicating them.
_Avoid_: prompt, plugin, template contract

**Skill Release**:
An immutable `vMAJOR.MINOR.PATCH` Git tag on the Kakeai repository and its paired GitHub Release, used as the only install source for the Production Skills and as the common version of the Kakeai app and skills.
_Avoid_: latest tag, branch install

**Script Operation**:
A named, reversible edit applied to a Content Document, such as adding a scene, splitting a line, or changing a cue range. Operations are applied to a document and never persist themselves.
_Avoid_: JSON patch, mutation, form update

**Script Operation Core**:
The single implementation of Script Operations shared by the Web UI, the API, and agent bindings. It owns editing semantics but not storage.
_Avoid_: editor service, form logic

**Narration Segment**:
The smallest unit of spoken content, with separate caption and spoken text, an optional selected Audio Take, and an optional per-line Expression Preset reference.
_Avoid_: Subtitle, audio file

**Narration Gap**:
An intentional silent interval immediately before a Narration Segment. It is not a Narration Segment and has no caption, speech, or speaker performance.
_Avoid_: Blank narration, audio offset

**Audio Take**:
An immutable candidate audio recording for one Narration Segment. A segment may select one take or deliberately have no audio.
_Avoid_: Narration segment, BGM

**Scene**:
A template-defined editorial unit of a Script Version, identified by a kind, with a duration, a per-scene accent color, narration lines, and visual cues. Text is expressed as visual cues, not typed slots.
_Avoid_: Visual cue, template

**Insert Scene**:
A Scene that pauses narration to present one source video and, by default, its embedded audio as a self-contained insert.
_Avoid_: Background video, point scene

**Embedded Video Audio**:
The audio stream contained in the source video of an Insert Scene, synchronized with that Scene's video rather than represented as a separate Audio Take.
_Avoid_: Narration, Scene Audio Cue

**Scene Label**:
A required, saved, non-rendered editing name for a Scene, shown in navigation and lists to tell Scenes apart. It is separate from a heading text cue and is not an identifier.
_Avoid_: heading, title, scene id

**Speaker**:
The voice identity for a Narration Segment, whether or not it appears on screen.
_Avoid_: Character, narrator

**Voice Profile**:
An app-wide voice setting for one locale that maps a Speaker to a TTS adapter and its adapter-defined voice.
_Avoid_: Speaker, TTS engine

**Voice**:
An adapter-defined selectable voice, identified by an opaque voice id and optionally declaring its locale.
_Avoid_: Speaker, Voice Profile

**TTS Adapter**:
A registered local text-to-speech engine boundary, keyed by an immutable adapter id, that lists voices and synthesizes audio for a Voice Profile.
_Avoid_: TTS engine, voice profile

**Character**:
A person or avatar that may, but need not, have standing appearances, and may, but need not, be associated with a Speaker.
_Avoid_: Speaker, voice

**Character Appearance**:
A particular visual form of a Character, such as a standing image with an expression and pose. It may optionally reference one Face Set for per-line expression switching, and it carries its own Standing Layout.
_Avoid_: Character, asset

**Standing Layout**:
The default scale, edge margin, and vertical position of a Character Appearance when it is shown as a standing image. A standing Cue may override it; a Standing State never does.
_Avoid_: Cue input, coordinates

**Standing State**:
A line-boundary state for one side of a Scene that selects a Character Appearance or hides the standing. It stays in effect until the next Standing State for that side or the Scene end.
_Avoid_: Character appearance, cue

**Scene Opening State**:
The left and right standing at the start of a Scene, before any line. It is stored as scene-range standing Cues and remains the fallback when no Standing State applies.
_Avoid_: Default state, base cue

**Face Set**:
An app-wide library of compatible face materials (Face Layers and Expression Presets) shared across appearances, referenced by id and not copied into a Script Version. It holds one required normal Expression Preset.
_Avoid_: Character appearance, asset

**Face Layer**:
A same-size transparent image for one face part (brow, eye, mouth, or an optional foreground) that a Face Set composes over a standing base image.
_Avoid_: Character appearance, asset

**Expression Preset**:
A stable, Face Set-scoped name for a combination of brow, eye, and mouth Face Layers. A Narration Segment references it by id to switch expression during its utterance.
_Avoid_: face tag, animation

**Character Library**:
The app-wide set of reusable Character definitions that are copied into a Script Version when used.
_Avoid_: Character, asset

**Asset**:
An immutable, app-local reusable media file used by a production. Its logical identity is retained when identical original bytes restore an unavailable file. User-assigned tags, favorites, and archive state are the only metadata editable after ingest. Archiving only hides an Asset from the default library and picker views; it is not a deletion.
_Avoid_: Background, BGM, visual

**Asset Tag**:
A user-assigned flat label on an Asset, used to classify and filter the asset library. It does not affect the asset's original bytes or identity.
_Avoid_: Character appearance tag, category

**Composition**:
A reusable AI-authored HyperFrames motion held by Kakeai as a versioned project, not as a media Asset.
_Avoid_: Asset, Work, Composition HTML

**Composition Draft**:
The mutable working copy of a Composition that an AI changes before publication.
_Avoid_: Composition Version, Script Version

**Composition Version**:
An immutable published bundle of one Composition that a Script Version may reference.
_Avoid_: Composition Draft, Asset Rendition

**Composition Scope**:
Whether a Composition is owned by one Work (`work`), available to every Work (`shared`), or left unclassified by the legacy migration (`unclassified`). It limits discovery, not whether a Script Version may reference the Composition.
_Avoid_: visibility, permission, tag

**Composition Archive**:
A reversible mark that hides a Composition from default library and picker views without deleting it or invalidating references.
_Avoid_: deletion, unpublish

**Canvas Profile**:
The fixed internal canvas a Composition Version renders into, chosen from a small set: `landscape` (1920×1080) or `portrait` (1080×1920). It is immutable per Composition Version and belongs to the Composition, not to the Work.
_Avoid_: Output size, resolution, aspect ratio

**Output Profile**:
The canvas a Work and all of its Language Editions, Script Versions, previews, and renders use: `landscape` (1920×1080) or `portrait` (1080×1920). It is fixed when the Work is created and never changes; a different profile requires a derived Work.
_Avoid_: Canvas Profile, resolution, orientation, aspect ratio

**Job**:
A durable record of one asynchronous operation on a Work or its edition.
_Avoid_: Render, task

**Render**:
The production of video output by a render Job.
_Avoid_: Asset, Artifact

**Artifact**:
A file produced by a Job as its output. It is not an Asset and becomes reusable only through an explicit promotion.
_Avoid_: Asset, Render

**Preview Frame**:
A full-resolution still PNG extracted from a render Artifact at a requested time, used by an Agent to report visual observations. The final quality judgment stays with the user.
_Avoid_: Thumbnail, preview video

**Script Preview Frame**:
A full-resolution still PNG rasterized from a saved ScriptVersion's compiled preview HTML at a requested absolute time, or at an offset from a specified Narration Segment, before any render Job exists. It reads the same HTML compiler as the Web UI preview.
_Avoid_: Render, draft preview

**Script Difference**:
A structural comparison of two saved Script Versions in one Language Edition, using stable Scene, Narration Segment, and Visual Cue identifiers to summarize additions, removals, content changes, and moves. It is not an edit history or a reconstruction of operation-created identifiers.
_Avoid_: edit log, JSON patch, created result

**Asset Preview Frame**:
The visual content of one Asset returned to an Agent: the stored image bytes for an image, or a still PNG at a requested time for a video. Audio has no visual content.
_Avoid_: Thumbnail, Asset content URL

**Visual Template**:
A trusted reusable visual expression with a defined input contract.
_Avoid_: Visual cue, scene

**Text Inset** (テキストの端余白):
The preset distance kept between a text block and the canvas edge when the text is anchored to that edge. It is chosen per cue, not as free coordinates, and platform safe areas take precedence.
_Avoid_: padding value, margin config, offset

**Container-Relative Layout**:
A Visual Template layout whose dimensions follow the size of its containing element through container queries, instead of fixed canvas pixels, so one template renders at different widths without duplication.
_Avoid_: responsive breakpoint, media query, scaling

**Chat Template**:
A data-driven Visual Template that arranges a short conversation as chat bubbles, with an optional phone or laptop frame and a static status bar. It is shown as video only and is not tied to narration, speakers, or TTS.
_Avoid_: Narration, Speaker, site mockup

**Caption Safe Area** (字幕セーフエリア):
The bottom band of the canvas reserved for the baked-in caption layer, derived from the caption text style and surface. Visual Templates that must stay readable beside a caption keep their content above it instead of relying on layer order.
_Avoid_: caption margin, safe zone config, caption layer padding

**Caption Layout** (字幕レイアウト):
Whether the baked-in caption is drawn as a centered two-line frame or as a full-width three-line band. Selected by the Visual Theme, fixed per revision, and independent of whether the speaker label is shown.
_Avoid_: caption template, subtitle style

**Speaker Label** (話者名タブ):
A small tab overlapped at the top-left of the baked-in caption showing the line Speaker name. Shown only when the Work enables it, never counted as a caption line, and never exported to SRT.
_Avoid_: speaker badge, caption title, narration label

**Chat Composer** (入力ドック):
The decorative input bar and send icon at the bottom of a phone-framed Chat Template. It is a static part of the frame's appearance, holds no editable value, and is not a template input.
_Avoid_: message input, form field, composer schema

**Terminal Template** (ターミナル):
A data-driven Visual Template that shows a floating macOS-style terminal window with a prompt, typed input lines, and output lines. It is shown as video only and is not tied to narration, speakers, or TTS.
_Avoid_: Chat Template, code block, shell

**Terminal Turn**:
One input/output pair in a Terminal Template. A turn is the unit that a reveal effect shows; a turn without an effect is visible from the start of the cue.
_Avoid_: message, line, command output

**Terminal Reveal**:
A terminal-specific display effect that starts a turn at a line or cue trigger, types the input at a fixed speed, and then shows the output. It is distinct from the shared appearance effects because it coordinates input completion with output display.
_Avoid_: appear, transition, animation preset

**Node**:
An item of a Flow Diagram, referenced by its position in the diagram's node list. It carries a label and an optional caption.
_Avoid_: Step, box

**Edge**:
A directed connection between two Nodes of a Flow Diagram, referencing them by index. It may carry a label.
_Avoid_: Arrow, link

**Flow Layout** (フローレイアウト):
The arrangement rule for a Flow Diagram: linear follows the node-list order on one axis, while cycle places that order clockwise around a loop.
_Avoid_: graph layout, free positioning

**Self-loop** (自己ループ):
An Edge whose source and destination are the same Node, expressing a retry, continuation, or recheck within that Node.
_Avoid_: duplicate node, repeat step

**Backward Edge** (後ろ向き辺):
In a linear Flow Layout, an Edge from a later Node-list position to an earlier one, expressing feedback or a return to a prior step.
_Avoid_: reverse layout, backward node

**Visual Cue** (映像演出):
An instruction to display one Visual Template with specific inputs over a segment of a Scene, on a named layer and with an enter/exit transition. The editor shows it to users as 映像演出. It is distinct from an Audio Cue, which places sound over a Work or Scene range, and from a Video Gate, which holds a source-video playhead for Narration Segments.
_Avoid_: Asset, template, Audio Cue, Video Gate

**Cue Map**:
A non-persistent editor navigation view that lays Scenes and Narration Segments in order and shows the ranges and visual stacking of Visual Cues as lanes. It is not a rendering timeline and never changes editorial data.
_Avoid_: Timeline, track, storyboard

**Visual Theme**:
An app-managed visual identity whose selected Theme Revision supplies default visual tokens and selects one Visual Skin for a Script Version. Explicit cue inputs always override it.
_Avoid_: UI theme, site mockup theme

**Theme Revision**:
An immutable published definition of one Visual Theme, identified by its theme id and version number. A Script Version may reference only a published revision.
_Avoid_: Theme draft, theme update

**Theme Draft**:
A mutable, non-renderable working definition of a Visual Theme used only by the theme editor and its preview.
_Avoid_: Theme Revision, Script Version

**Visual Skin**:
An app-managed, versioned visual grammar shared by supported Visual Templates and Composition authoring. It supplies trusted rendering rules and falls back to neutral rendering when a Template is unsupported.
_Avoid_: Theme, arbitrary CSS, Asset

**Style Kit**:
An immutable trusted bundle of a Visual Skin's authoring rules, CSS, font aliases, and reusable visual parts, copied into an AI-authored Composition bundle.
_Avoid_: User asset, plugin

**Composition Authoring Context**:
A non-persistent, resolved input that gives an AI a published Theme Revision, Visual Skin, Style Kit, and font diagnostics before it creates a Composition Draft.
_Avoid_: CompositionVersion, Script Version

**Composition Style Provenance**:
Immutable metadata on a published CompositionVersion that records the Theme Revision, Visual Skin, Style Kit, and font diagnostics used when authoring it.
_Avoid_: Runtime theme override

**Font Face**:
One selectable installed typeface face, including its family, weight, style, and platform-specific identifier. A Visual Theme uses it as a default while retaining a fallback when it is unavailable.
_Avoid_: Font category, font file

**Layer**:
A named, ordered region of a Scene where Visual Cues are drawn (background, card, standing, overlay). It fixes the draw order independent of cue array order.
_Avoid_: Visual cue, track

**Nested Visual**:
A media asset or a trusted template instance placed inside a Composite Visual Template's input. It carries no range, layer, or transition of its own.
_Avoid_: Visual cue, child scene

**Video Gate Playback**:
A playback policy on a video media reference that holds the source playhead at declared source times until the corresponding Narration Segments begin.
_Avoid_: Video template, pause button, time remapping

**Video Gate**:
One ordered correspondence between a Narration Segment start and a source-video time that the playhead cannot pass before that Segment begins.
_Avoid_: Cue trigger, keyframe, seek target

**Video Gate Audio**:
The optional embedded-video audio policy for one source interval after a Video Gate. It is audible only while that video interval advances, never while its frame is held.
_Avoid_: Audio Cue, Insert Scene embedded audio

**Composite Visual Template**:
A trusted Visual Template that composes Nested Visuals into a layout with its own internal animation, and can be placed as a background or card.
_Avoid_: Composition HTML, scene

**Site Mockup**:
A frame-type Composite Visual Template that places a user's image or video inside the chrome of a known site or browser, using generic styling and an optional user-provided logo.
_Avoid_: fake post, screenshot

**Cue Transition**:
The enter/exit presentation of a Visual Cue, expressed only as a registered preset and a duration, bounded within the cue's range.
_Avoid_: animation, keyframe

**Scene Transition**:
The cut, fade, or crossfade presentation at a Scene boundary, expressed only as a registered preset and a duration and bounded by the adjacent Scenes' durations. It is separate from a cue transition.
_Avoid_: animation, cue transition

**Animation Plan**:
The bounded, local-time animation a template renderer returns for its own elements (target, preset, start, duration). Only the top-level compiler turns it into a timeline.
_Avoid_: keyframe, timeline

**Cue Trigger**:
A line range or the whole cue window that fires a Cue Effect inside a Visual Cue. It references narration lines by id, never by seconds.
_Avoid_: keyframe, timing, animation

**Cue Effect**:
A change a Visual Template applies to one of its own elements when a Cue Trigger is reached: a one-shot appearance or a sustained emphasis. It is distinct from a cue transition, which bounds the whole cue.
_Avoid_: animation, cue transition, keyframe

**Sustained Emphasis**:
A Cue Effect that highlights a target while its line range is active and reverts at the range's end.
_Avoid_: highlight state, css class

**Onset**:
An optional one-shot flourish of an emphasis that plays once when the Cue Trigger is reached, on a transient sub-element separate from the sustained emphasis.
_Avoid_: keyframe, intro animation

**Spotlight**:
An emphasis style that highlights a target while dimming its sibling elements for the range. Siblings are resolved by the template.
_Avoid_: dim, mute, focus

**Value Animation**:
A cue effect that progresses a numeric target from a start value to its value over a trigger range, formatted as static display. The compiler alone turns it into a value tween.
_Avoid_: timer, counter script

**Template Field**:
A declarative input-field spec (`inputFields`) on a Visual Template that drives the generic Cue editor, so adding a template needs no editor code.
_Avoid_: form schema, zod

**Audio Cue**:
An instruction to place an audio Asset, such as background music, a sound effect, or program audio, over a Work or Scene range.
_Avoid_: BGM asset, narration segment

**Thumbnail**:
A YouTube-facing image candidate for one Language Edition, held as a mutable small document that references a Thumbnail Template. Multiple candidates may exist, with one selected for upload.
_Avoid_: cover image, render, Artifact, Script Version

**Thumbnail Template**:
A trusted reusable thumbnail layout with a defined input contract, separate from a Visual Template.
_Avoid_: Visual Template, scene, Visual Cue

**Thumbnail Appearance**:
A sparse visual override for thumbnails that is layered over the current Visual Theme. One appearance belongs to a Work and is shared by all of its Language Editions; each Thumbnail may carry a further sparse override. Unset properties keep following the Theme, and the Work appearance is resolved live when a candidate is previewed or rendered. Font Face is set per locale, falling back to the Theme's font for that locale.
_Avoid_: Theme, Theme Draft, template preset

**Thumbnail Appearance Preset**:
An app-wide named snapshot of a sparse Thumbnail Appearance patch. Applying it copies the patch into a Work's common appearance draft; the Work does not reference the preset afterwards.
_Avoid_: Theme, live preset, Theme Draft

**Foreground Cutout**:
A transparent-background image Asset placed as the subject of a thumbnail template, anchored to the bottom edge. Its transparency is not inspected by the app.
_Avoid_: background removal result, character image, main visual

**Rich Text Value**:
A thumbnail text input that carries inline emphasis in a small plain-text syntax, mapped to the resolved Thumbnail Appearance and the owning Thumbnail Template rather than raw user CSS. It stays an ordinary string in the saved document.
_Avoid_: HTML, Markdown document, rich text editor state

**YouTube Video Settings**:
A set of mutable, edition-scoped YouTube publication metadata (title, description, tags, category, visibility, declarations, and interactive settings) stored independently of Script Versions.
_Avoid_: Upload job, OAuth config, video ID

**YouTube Scene Chapters**:
A generated list of timestamped lines (`MM:SS Label` or `HH:MM:SS Label`) derived from the narration scenes of a saved Script Version, formatted for YouTube description text.
_Avoid_: Video chapter track, VTT cue, auto chapter

**Set Operation**:
An Agent/Script operation whose name indicates full replacement of the named value; other values are unchanged.

**Update Operation**:
An Agent/Script operation that changes only the specified fields; omitted fields stay unchanged.

**Upsert Operation**:
An operation that creates when absent and partially updates when present.

**Save Operation**:
An operation that saves a whole document or draft; not for partial updates.

## Live

**Live Format**:
A reusable preset for a live show: segment skeleton, cast, stage, theme, comment/safety/playout defaults, and optional boilerplate cards. It is copied into a Live Program when the program is created; later format edits do not change existing programs.
_Avoid_: template document, composition

**Live Program**:
The live-only manuscript for one episode: segments, cues, cards, imported materials, CutIns, comment policy, safety, and playout. It owns its captions, speech, speakers, and expressions. It does not reference a Work or Script Version line.
_Avoid_: script version, show profile, composition

**Live Program Version**:
An immutable snapshot of a Live Program. Export and live start use a version, never the editable draft.
_Avoid_: draft, render

**Live Show**:
A scheduled, state-driven performance defined by a Live Program Version, separate from a rendered Composition. It is not a Script Version, Render Job, or Artifact.
_Avoid_: live render, composition playback

**Live Package**:
An immutable build from a Live Program Version containing its theme CSS, character assets, card definitions and card assets, imported material cards, CutIn videos, and prepared audio. The live app reads it; it does not share Kakeai's database.
_Avoid_: project, asset bundle, script

**Live Run**:
One execution of a live show, fixing the Live Program Version, the exact package build, the comment source or fixture, the start time, the port, the control endpoint, and the run log. It never stores credentials or model connection settings.
_Avoid_: package, job, session

**Show Profile**:
Legacy live configuration used before Live Program. It references Script Version lines and is not the current source of truth. See [ADR-0131](docs/adr/0131-live-program-owns-live-script.md).
_Avoid_: live program, script

**Spine**:
The ordered segment list of a Live Program that defines its planned progression. It is not a Composition timeline.
_Avoid_: timeline, storyboard

**Material Bank**:
Optional extra topics, bits, and fallback material a Live Show can use when time allows or when the spine needs adjustment. It is not a Script Version.
_Avoid_: script, asset library

**Stage**:
The browser surface that renders the live state: characters, caption, card, imported material, CutIn, comment card, and phase. The Program Stage is captured by OBS; the Preview Stage is not. It is not a Composition player.
_Avoid_: composition, preview, canvas

**Playout**:
The state-driven audio, cue queue, and CutIn playback that advance the Stage. It is not a timeline.
_Avoid_: timeline, render queue

**Live Cue**:
The smallest unit of live output owned by a Live Program: speaker, caption, speech, expression, an optional Visual Ref, and audio. An omitted Visual Ref inherits the containing segment's default; `null` hides the centre slot.
_Avoid_: narration segment, clip

**Live Card**:
A typed card owned by a Live Program: headline, image, list, chart, or quote. It carries states and an entry/update animation contract. It is rendered by the live card renderer, not by a video Visual Template or composition.
_Avoid_: visual template, material card, slide

**Live Card State**:
A complete snapshot of a Live Card's visible content at one cue. States are not patches; stable element ids let the renderer update only the delta.
_Avoid_: patch, keyframe, frame

**Card Ref**:
A reference to a card and one of its states: `{ cardId, stateId }`. It is one branch of a Visual Ref.
_Avoid_: material id, visual cue

**Visual Ref**:
The single reference for the stage's centre slot: a card state, an imported material, or `null` to hide it. An omitted cue visual inherits the segment default. Cards and materials are never selected together.
_Avoid_: card ref, material id, both

**Live Material**:
A program-owned snapshot of a Work scene imported for the live stage, including its dependent image assets. The Work/Scene ids remain provenance only; live export never resolves them again.
_Avoid_: work scene, material card reference

**Live Renderer**:
The shared DOM/SVG renderer for Live Cards. It uses Shadow DOM, keyed diff updates, and CSS/WAAPI animations. The editor preview and the live stage use the same renderer; it does not depend on the video compiler.
_Avoid_: composition player, HyperFrames player

**Material Card**:
A static PNG/HTML or short silent MP4 imported from a Work scene and shown in the Stage's center slot. It is distinct from a Live Card and is created by Kakeai at export time.
_Avoid_: live card, visual cue, slide, composition

**CutIn**:
A short full-screen video inserted at a spine boundary to mark a corner break, with an optional embedded audio track and a probe-derived duration. It is a dedicated segment and package kind, not a Material Card or a Live Cue.
_Avoid_: material card, live cue, insert scene

**CutIn Segment**:
A Spine segment that plays one CutIn between normal segments. It carries no cues, material, or comment policy of its own; its duration comes from the CutIn it references.
_Avoid_: material segment, cue

**CutIn Occurrence**:
One playback of a CutIn Segment, identified by its segment, attempt, and playback sequence. The same CutIn can be reused at several boundaries, and each playback is a separate occurrence.
_Avoid_: cue attempt, loop

**CutIn Asset**:
The video Asset a CutIn is authored from. Export resolves it to the verified video stored in the Live Package.
_Avoid_: material card, composition

**CutIn Playback**:
The full-screen playback of a CutIn, separate from Live Cue playback. Only the Program Stage plays its embedded audio; the Preview Stage stays muted.
_Avoid_: cue playback, material card playback

**Prepared Cue**:
A Live Cue resolved at export from a Live Program Version, before playout. Its caption, speech, speaker, expression, audio, and card/material references are fixed in the Live Package.
_Avoid_: live cue, narration segment, script cue

**Script Cue**:
A Live Cue whose caption, speech, speaker, and audio come from a Narration Segment via a line id.
_Avoid_: live-only cue, caption

**Live-only Cue**:
A Live Cue authored for the live show, not present in the Script Version, such as an opening, correction, or fallback.
_Avoid_: script cue, ad-lib

**Program Stage**:
The single Stage that holds the Playback Lease and plays audio. It is the Stage captured by OBS.
_Avoid_: preview, console

**Preview Stage**:
A muted, event-disabled Stage shown in the Operator Console. It never advances playback.
_Avoid_: program stage, OBS

**Playback Lease**:
The exclusive right to play the current Live Cue and send playback events for one run. Only the Program Stage holds it.
_Avoid_: lock, session

**Comment Corner**:
A bounded segment of a Live Show where viewer comments are selected and answered. It is not a continuous chat overlay.
_Avoid_: chat, comment feed

**Human Pin**:
A comment the operator explicitly selects for the next Comment Corner. It takes precedence over AI candidates but cannot override safety blocks.
_Avoid_: approval, favorite

**AI Candidate**:
A comment proposed by the Comment Analyst to fill the remaining slots of a Comment Corner.
_Avoid_: selection, pick

**Comment Source**:
The read-only boundary that supplies viewer comments, either YouTube live chat or a test fixture.
_Avoid_: chat API, scraper

**Comment Analyst**:
The structured filter that scores and classifies comments before the Live Director sees them. It does not write responses.
_Avoid_: director, moderator

**Live Director**:
The live-side decision loop that selects cues and generates comment responses. It does not manage the YouTube broadcast.
_Avoid_: host, agent

**Local LLM**:
A model endpoint on the same machine as the live app, used for real YouTube comment analysis and response generation. It does not send YouTube data to external services.
_Avoid_: cloud model, external LLM

**External LLM**:
A model endpoint outside the machine. In v1 it may receive only fixture comments, never real YouTube comments.
_Avoid_: local model, production model

**Operator Console**:
The local control surface for pinning, skipping, pausing, stopping, editing, and reviewing logs. It is not captured by OBS.
_Avoid_: stage, admin panel

**Test Mode**:
A Live Show run driven by a fixture Comment Source instead of YouTube, while using the real Comment Analyst, Live Director, TTS, Stage, and Operator Console.
_Avoid_: mock, demo

**Safe Mode**:
A live state that stops generated responses and plays only prepared or fallback cues.
_Avoid_: pause, stop

**Pre-show**:
The Stage phase before the opening, showing the title, countdown, and waiting characters.
_Avoid_: opening

**Post-show**:
The Stage phase after the closing, showing the end card and thanks.
_Avoid_: ending
