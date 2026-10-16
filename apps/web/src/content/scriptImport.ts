import {
  createEmptyLine,
  createPointSceneFormValue,
  type SceneFormValue,
} from "./form";

export const SCRIPT_CHAPTER_PREFIX = "##";

export interface ScriptLine {
  lineNumber: number;
  speakerName: string;
  text: string;
}

export interface ScriptChapter {
  lineNumber: number;
  heading: string;
  lines: ScriptLine[];
}

export interface ScriptDiagnostic {
  lineNumber: number;
  message: string;
}

export interface ParsedScript {
  chapters: ScriptChapter[];
  speakerNames: string[];
  diagnostics: ScriptDiagnostic[];
}

export type SpeakerAssignmentMap = Record<string, string | null>;

export type ScriptImportMode = "replace" | "append";

export function splitDialogueLine(
  line: string,
): { speakerName: string; text: string } | null {
  const halfWidth = line.indexOf(":");
  const fullWidth = line.indexOf("：");
  let separator = -1;
  if (halfWidth !== -1 && fullWidth !== -1) {
    separator = Math.min(halfWidth, fullWidth);
  } else if (halfWidth !== -1) {
    separator = halfWidth;
  } else if (fullWidth !== -1) {
    separator = fullWidth;
  }
  if (separator === -1) {
    return null;
  }
  return {
    speakerName: line.slice(0, separator).trim(),
    text: line.slice(separator + 1).trim(),
  };
}

export function parseScript(text: string): ParsedScript {
  const chapters: ScriptChapter[] = [];
  const speakerNames: string[] = [];
  const seenSpeakerNames = new Set<string>();
  const diagnostics: ScriptDiagnostic[] = [];
  let current: ScriptChapter | null = null;

  const rawLines = text.split(/\r\n|\r|\n/);
  rawLines.forEach((raw, index) => {
    const lineNumber = index + 1;
    const line = raw.trim();
    if (line.length === 0) {
      return;
    }
    if (line.startsWith(SCRIPT_CHAPTER_PREFIX)) {
      const heading = line.slice(SCRIPT_CHAPTER_PREFIX.length).trim();
      if (heading.length === 0) {
        diagnostics.push({ lineNumber, message: "章見出しが空です。" });
        return;
      }
      current = { lineNumber, heading, lines: [] };
      chapters.push(current);
      return;
    }
    const dialogue = splitDialogueLine(line);
    if (dialogue === null) {
      diagnostics.push({
        lineNumber,
        message: "書式に合わない行です。章見出し（## ...）か「話者名: セリフ」を入力してください。",
      });
      return;
    }
    if (current === null) {
      diagnostics.push({ lineNumber, message: "章見出しより前にセリフがあります。" });
      return;
    }
    if (dialogue.speakerName.length === 0) {
      diagnostics.push({ lineNumber, message: "話者名が空です。" });
      return;
    }
    if (dialogue.text.length === 0) {
      diagnostics.push({ lineNumber, message: "セリフが空です。" });
      return;
    }
    current.lines.push({
      lineNumber,
      speakerName: dialogue.speakerName,
      text: dialogue.text,
    });
    if (!seenSpeakerNames.has(dialogue.speakerName)) {
      seenSpeakerNames.add(dialogue.speakerName);
      speakerNames.push(dialogue.speakerName);
    }
  });

  for (const chapter of chapters) {
    if (chapter.lines.length === 0) {
      diagnostics.push({ lineNumber: chapter.lineNumber, message: "章にセリフがありません。" });
    }
  }
  if (chapters.length === 0) {
    diagnostics.push({ lineNumber: 1, message: "章見出しがありません。" });
  }

  return { chapters, speakerNames, diagnostics };
}

export function unresolvedSpeakerNames(
  script: ParsedScript,
  assignments: SpeakerAssignmentMap,
): string[] {
  return script.speakerNames.filter(
    (name) => !Object.prototype.hasOwnProperty.call(assignments, name),
  );
}

function buildChapterScene(
  chapter: ScriptChapter,
  assignments: SpeakerAssignmentMap,
  usedSceneIds: Set<string>,
  usedLineIds: Set<string>,
): SceneFormValue {
  const scene = createPointSceneFormValue(chapter.heading.trim(), usedSceneIds);
  usedSceneIds.add(scene.id);
  scene.lines = chapter.lines.map((line) => {
    const value = createEmptyLine(scene.id, usedLineIds);
    usedLineIds.add(value.id);
    value.captionText = line.text;
    value.speechText = line.text;
    value.speakerId = Object.prototype.hasOwnProperty.call(assignments, line.speakerName)
      ? (assignments[line.speakerName] ?? null)
      : null;
    return value;
  });
  return scene;
}

function lastPointIndex(scenes: readonly SceneFormValue[]): number {
  let found = -1;
  scenes.forEach((scene, index) => {
    if (scene.kind === "point") {
      found = index;
    }
  });
  return found;
}

function firstPointIndex(scenes: readonly SceneFormValue[]): number {
  return scenes.findIndex((scene) => scene.kind === "point");
}

function mergeImportedScenes(
  existing: readonly SceneFormValue[],
  generated: readonly SceneFormValue[],
  mode: ScriptImportMode,
): SceneFormValue[] {
  if (mode === "replace") {
    const firstPoint = firstPointIndex(existing);
    const remaining = existing.filter((scene) => scene.kind !== "point");
    let beforeCount: number;
    if (firstPoint === -1) {
      const outro = remaining.findIndex((scene) => scene.kind === "outro");
      beforeCount = outro === -1 ? remaining.length : outro;
    } else {
      beforeCount = existing
        .slice(0, firstPoint)
        .filter((scene) => scene.kind !== "point").length;
    }
    return [
      ...remaining.slice(0, beforeCount),
      ...generated,
      ...remaining.slice(beforeCount),
    ];
  }
  const lastPoint = lastPointIndex(existing);
  let insertAt: number;
  if (lastPoint === -1) {
    const outro = existing.findIndex((scene) => scene.kind === "outro");
    insertAt = outro === -1 ? existing.length : outro;
  } else {
    insertAt = lastPoint + 1;
  }
  return [...existing.slice(0, insertAt), ...generated, ...existing.slice(insertAt)];
}

export interface BuildImportedScenesOptions {
  script: ParsedScript;
  assignments: SpeakerAssignmentMap;
  mode: ScriptImportMode;
  existingScenes: readonly SceneFormValue[];
}

export function buildImportedScenes(options: BuildImportedScenesOptions): SceneFormValue[] {
  const { script, assignments, mode, existingScenes } = options;
  if (script.diagnostics.length > 0) {
    throw new Error("台本にエラーがあります。");
  }
  const unresolved = unresolvedSpeakerNames(script, assignments);
  if (unresolved.length > 0) {
    throw new Error(`話者「${unresolved.join("、")}」の割り当てを選択してください。`);
  }
  const usedSceneIds = new Set(existingScenes.map((scene) => scene.id));
  const usedLineIds = new Set(
    existingScenes.flatMap((scene) => scene.lines.map((line) => line.id)),
  );
  const generated = script.chapters.map((chapter) =>
    buildChapterScene(chapter, assignments, usedSceneIds, usedLineIds),
  );
  return mergeImportedScenes(existingScenes, generated, mode);
}
