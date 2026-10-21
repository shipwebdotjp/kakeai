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
A particular visual form of a Character, such as a standing image with an expression and pose. It may optionally reference one Face Set for per-line expression switching.
_Avoid_: Character, asset

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

**Canvas Profile**:
The fixed internal canvas a Composition Version renders into, chosen from a small set: `landscape` (1920×1080) or `portrait` (1080×1920). It is immutable per Composition Version and does not change the fixed 1920×1080 size of the surrounding render.
_Avoid_: Output size, resolution, aspect ratio

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

**Visual Template**:
A trusted reusable visual expression with a defined input contract.
_Avoid_: Visual cue, scene

**Container-Relative Layout**:
A Visual Template layout whose dimensions follow the size of its containing element through container queries, instead of fixed canvas pixels, so one template renders at different widths without duplication.
_Avoid_: responsive breakpoint, media query, scaling

**Chat Template**:
A data-driven Visual Template that arranges a short conversation as chat bubbles, with an optional phone or laptop frame and a static status bar. It is shown as video only and is not tied to narration, speakers, or TTS.
_Avoid_: Narration, Speaker, site mockup

**Node**:
An item of a Flow Diagram, referenced by its position in the diagram's node list. It carries a label and an optional caption.
_Avoid_: Step, box

**Edge**:
A directed connection between two Nodes of a Flow Diagram, referencing them by index. It may carry a label.
_Avoid_: Arrow, link

**Visual Cue**:
An instruction to display one Visual Template with specific inputs over a segment of a Scene, on a named layer and with an enter/exit transition.
_Avoid_: Asset, template

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

**Rich Text Value**:
A thumbnail text input that carries inline emphasis in a small plain-text syntax, mapped by the owning Thumbnail Template to Theme tokens rather than user-chosen colors or fonts. It stays an ordinary string in the saved document.
_Avoid_: HTML, Markdown document, rich text editor state
