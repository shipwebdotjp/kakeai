import type { RefObject } from "react";
import type { ContentDocument, ScriptVersion } from "@kakeai/contracts";
import type { DiagnosticTarget } from "../../content/diagnostics";
import type {
  CharacterFormValue,
  SceneFormValue,
  SpeakerFormValue,
} from "../../content/form";
import type { UnsavedDocumentState } from "../../lib/useDraftPreview";

export interface SceneEditorProps {
  base: ContentDocument;
  editionId: string;
  scriptVersionId: string;
  onSaved?: (scriptVersion: ScriptVersion) => void;
  onValuesChange?: (
    scenes: SceneFormValue[],
    speakers: SpeakerFormValue[],
    characters: CharacterFormValue[],
  ) => void;
  onJumpToLine?: (lineId: string) => void;
  onJumpToTarget?: (targetId: string, seek: DiagnosticTarget["seek"]) => void;
  onDocumentChange?: (state: UnsavedDocumentState) => void;
  onDirtyChange?: (dirty: boolean) => void;
  scrollContainerRef?: RefObject<HTMLDivElement | null>;
}

export type ScenePickerRequest =
  | { kind: "move-cue" | "copy-cue"; sceneId: string; cueId: string }
  | {
      kind: "move-standing" | "copy-standing" | "swap-standing";
      sceneId: string;
    };
