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

**Narration Segment**:
The smallest unit of spoken content, with separate caption and spoken text, an optional selected Audio Take, and an optional per-line Expression Preset reference.
_Avoid_: Subtitle, audio file

**Audio Take**:
An immutable candidate audio recording for one Narration Segment. A segment may select one take or deliberately have no audio.
_Avoid_: Narration segment, BGM

**Scene**:
A template-defined editorial unit of a Script Version, identified by a kind, with a duration, a per-scene accent color, narration lines, and visual cues. Text is expressed as visual cues, not typed slots.
_Avoid_: Visual cue, template

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

**Job**:
A durable record of one asynchronous operation on a Work or its edition.
_Avoid_: Render, task

**Render**:
The production of video output by a render Job.
_Avoid_: Asset, Artifact

**Artifact**:
A file produced by a Job as its output. It is not an Asset and becomes reusable only through an explicit promotion.
_Avoid_: Asset, Render

**Visual Template**:
A trusted reusable visual expression with a defined input contract.
_Avoid_: Visual cue, scene

**Visual Cue**:
An instruction to display one Visual Template with specific inputs over a segment of a Scene, on a named layer and with an enter/exit transition.
_Avoid_: Asset, template

**Cue Map**:
A non-persistent editor navigation view that lays Scenes and Narration Segments in order and shows the ranges and visual stacking of Visual Cues as lanes. It is not a rendering timeline and never changes editorial data.
_Avoid_: Timeline, track, storyboard

**Visual Theme**:
An app-managed visual identity whose selected Theme Revision supplies default visual tokens to a Script Version. Explicit cue inputs always override it.
_Avoid_: UI theme, site mockup theme

**Theme Revision**:
An immutable published definition of one Visual Theme, identified by its theme id and version number. A Script Version may reference only a published revision.
_Avoid_: Theme draft, theme update

**Theme Draft**:
A mutable, non-renderable working definition of a Visual Theme used only by the theme editor and its preview.
_Avoid_: Theme Revision, Script Version

**Font Face**:
One selectable installed typeface face, including its family, weight, style, and platform-specific identifier. A Visual Theme uses it as a default while retaining a fallback when it is unavailable.
_Avoid_: Font category, font file

**Layer**:
A named, ordered region of a Scene where Visual Cues are drawn (background, card, standing, overlay). It fixes the draw order independent of cue array order.
_Avoid_: Visual cue, track

**Nested Visual**:
A media asset or a trusted template instance placed inside a Composite Visual Template's input. It carries no range, layer, or transition of its own.
_Avoid_: Visual cue, child scene

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

**Template Field**:
A declarative input-field spec (`inputFields`) on a Visual Template that drives the generic Cue editor, so adding a template needs no editor code.
_Avoid_: form schema, zod

**Audio Cue**:
An instruction to place an audio Asset, such as background music, over a range of a work.
_Avoid_: BGM asset, narration segment

**Thumbnail**:
A YouTube-facing image candidate for one Language Edition, held as a mutable small document that references a Thumbnail Template. Multiple candidates may exist, with one selected for upload.
_Avoid_: cover image, render, Artifact, Script Version

**Thumbnail Template**:
A trusted reusable thumbnail layout with a defined input contract, separate from a Visual Template.
_Avoid_: Visual Template, scene, Visual Cue
