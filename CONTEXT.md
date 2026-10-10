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
The smallest unit of spoken content, with separate caption and spoken text and an optional selected Audio Take.
_Avoid_: Subtitle, audio file

**Audio Take**:
An immutable candidate audio recording for one Narration Segment. A segment may select one take or deliberately have no audio.
_Avoid_: Narration segment, BGM

**Scene**:
A template-defined editorial unit of a Script Version, with typed editorial slots, a duration, and a per-scene accent color.
_Avoid_: Visual cue, template

**Speaker**:
The voice identity for a Narration Segment, whether or not it appears on screen.
_Avoid_: Character, narrator

**Voice Profile**:
An app-wide voice setting that maps a Speaker to a TTS adapter and its adapter-specific voice.
_Avoid_: Speaker, TTS engine

**TTS Adapter**:
A registered local text-to-speech engine boundary, keyed by an immutable adapter id, that lists voices and synthesizes audio for a Voice Profile.
_Avoid_: TTS engine, voice profile

**Character**:
A person or avatar that may, but need not, have standing appearances, and may, but need not, be associated with a Speaker.
_Avoid_: Speaker, voice

**Character Appearance**:
A particular visual form of a Character, such as a standing image with an expression and pose.
_Avoid_: Character, asset

**Character Library**:
The app-wide set of reusable Character definitions that are copied into a Script Version when used.
_Avoid_: Character, asset

**Asset**:
An immutable, app-local reusable media file used by a production. Its logical identity is retained when identical original bytes restore an unavailable file.
_Avoid_: Background, BGM, visual

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

**Layer**:
A named, ordered region of a Scene where Visual Cues are drawn (background, card, standing, overlay). It fixes the draw order independent of cue array order.
_Avoid_: Visual cue, track

**Nested Visual**:
A media asset or a trusted template instance placed inside a Composite Visual Template's input. It carries no range, layer, or transition of its own.
_Avoid_: Visual cue, child scene

**Composite Visual Template**:
A trusted Visual Template that composes Nested Visuals into a layout with its own internal animation, and can be placed as a background or card.
_Avoid_: Composition HTML, scene

**Cue Transition**:
The enter/exit presentation of a Visual Cue, expressed only as a registered preset and a duration, bounded within the cue's range.
_Avoid_: animation, keyframe

**Audio Cue**:
An instruction to place an audio Asset, such as background music, over a range of a work.
_Avoid_: BGM asset, narration segment
