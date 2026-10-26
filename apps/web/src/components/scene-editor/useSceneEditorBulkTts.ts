import { useMemo, useState } from "react";
import type { UseFormGetValues, UseFormSetValue } from "react-hook-form";
import type {
  BulkTtsJobExclusion,
  ContentDocument,
  TtsJobResult,
} from "@kakeai/contracts";
import { useBulkGenerateTtsTakes, type BulkTtsFailure } from "../../api/hooks";
import {
  bulkTtsCandidateLineIds,
  generatedTakePolicy,
  mergeTake,
  type DocumentFormValues,
} from "../../content/form";

export interface BulkTtsSummary {
  succeeded: number;
  excluded: BulkTtsJobExclusion[];
  failed: BulkTtsFailure[];
}

export function useSceneEditorBulkTts({
  scriptVersionId,
  base,
  getValues,
  setValue,
}: {
  scriptVersionId: string;
  base: ContentDocument;
  getValues: UseFormGetValues<DocumentFormValues>;
  setValue: UseFormSetValue<DocumentFormValues>;
}) {
  const [bulkProgress, setBulkProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [bulkResult, setBulkResult] = useState<BulkTtsSummary | null>(null);
  const bulkGenerate = useBulkGenerateTtsTakes(scriptVersionId);

  const bulkCandidateCount = useMemo(
    () => bulkTtsCandidateLineIds(base).length,
    [base],
  );

  const addBulkTake = (narrationSegmentId: string, result: TtsJobResult) => {
    const scenes = getValues("scenes");
    for (let sceneIndex = 0; sceneIndex < scenes.length; sceneIndex += 1) {
      const scene = scenes[sceneIndex];
      if (scene === undefined) {
        continue;
      }
      const lineIndex = scene.lines.findIndex(
        (line) => line.id === narrationSegmentId,
      );
      if (lineIndex === -1) {
        continue;
      }
      const line = scene.lines[lineIndex];
      if (line === undefined) {
        continue;
      }
      const next = mergeTake(
        line,
        {
          assetId: result.assetId,
          durationMs: result.durationMs,
          source: "tts",
        },
        generatedTakePolicy("bulk").select,
      );
      setValue(`scenes.${sceneIndex}.lines.${lineIndex}.takes`, next.takes, {
        shouldDirty: true,
      });
      setValue(
        `scenes.${sceneIndex}.lines.${lineIndex}.selectedAudioTakeId`,
        next.selectedAudioTakeId,
        {
          shouldDirty: true,
        },
      );
      return;
    }
  };

  const onBulkGenerate = () => {
    setBulkResult(null);
    setBulkProgress(null);
    bulkGenerate.mutate(
      {
        onProgress: (done, total) => setBulkProgress({ done, total }),
        onJobSucceeded: (result) =>
          addBulkTake(result.narrationSegmentId, result),
      },
      {
        onSuccess: (summary) => {
          setBulkResult({
            succeeded: summary.succeeded,
            excluded: summary.excluded,
            failed: summary.failed,
          });
          setBulkProgress(null);
        },
        onError: () => setBulkProgress(null),
      },
    );
  };

  return {
    bulkGenerate,
    bulkProgress,
    bulkResult,
    bulkCandidateCount,
    onBulkGenerate,
    clearBulkResult: () => setBulkResult(null),
  };
}
