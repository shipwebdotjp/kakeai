import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  LiveProgramDetail,
  LiveProgramDocument,
  LiveProgramVersionDetail,
  ImportLiveMaterialRequest,
} from "@kakeai/contracts";
import {
  useFinalizeLiveProgramVersion,
  useImportLiveMaterial,
  useRestoreLiveProgramVersionDraft,
  useSaveLiveProgramDraft,
} from "../../api/hooks";
import { stableJson } from "../model/canonical";
import { hasBlockingDraftIssues } from "../model/validation";
import {
  buildFinalizeVersionRequest,
  buildRestoreVersionDraftRequest,
  buildSaveDraftRequest,
  parseLiveProgramRevisionConflict,
  type LiveProgramRevisionConflict,
} from "../model/version-actions";

export interface LiveProgramEditorState {
  document: LiveProgramDocument;
  revision: number;
  dirty: boolean;
  blockedByDraftIssues: boolean;
  conflict: LiveProgramRevisionConflict | null;
  lastFinalizedVersion: LiveProgramVersionDetail | null;
  updateDocument: (updater: (document: LiveProgramDocument) => LiveProgramDocument) => void;
  dismissConflict: () => void;
  reloadConflict: () => void;
  save: () => void;
  finalize: (note: string) => void;
  restoreVersion: (versionId: string) => void;
  importMaterial: (input: Omit<ImportLiveMaterialRequest, "expectedRevision">) => void;
  saveMutation: ReturnType<typeof useSaveLiveProgramDraft>;
  finalizeMutation: ReturnType<typeof useFinalizeLiveProgramVersion>;
  restoreMutation: ReturnType<typeof useRestoreLiveProgramVersionDraft>;
  importMutation: ReturnType<typeof useImportLiveMaterial>;
}

/**
 * Owns the local draft copy for one program. Server detail refetches do not
 * overwrite local edits; only save/restore/import responses and an explicit
 * conflict reload replace the local copy.
 */
export function useLiveProgramEditor(initial: LiveProgramDetail): LiveProgramEditorState {
  const programId = initial.id;
  const saveMutation = useSaveLiveProgramDraft(programId);
  const finalizeMutation = useFinalizeLiveProgramVersion(programId);
  const restoreMutation = useRestoreLiveProgramVersionDraft(programId);
  const importMutation = useImportLiveMaterial(programId);

  const [document, setDocument] = useState<LiveProgramDocument>(initial.draftDocument);
  const [baseline, setBaseline] = useState<LiveProgramDocument>(initial.draftDocument);
  const [revision, setRevision] = useState(initial.draftRevision);
  const [conflict, setConflict] = useState<LiveProgramRevisionConflict | null>(null);
  const [lastFinalizedVersion, setLastFinalizedVersion] =
    useState<LiveProgramVersionDetail | null>(null);

  const dirty = useMemo(
    () => stableJson(document) !== stableJson(baseline),
    [document, baseline],
  );
  const blockedByDraftIssues = useMemo(
    () => hasBlockingDraftIssues(document),
    [document],
  );

  // If the server detail advances while this editor has no local work, adopt
  // the newer draft. With unsaved edits we deliberately keep the old revision
  // so the next save returns a reloadable 409 conflict.
  useEffect(() => {
    if (!dirty && initial.draftRevision > revision) {
      setDocument(initial.draftDocument);
      setBaseline(initial.draftDocument);
      setRevision(initial.draftRevision);
    }
  }, [dirty, initial.draftDocument, initial.draftRevision, revision]);

  const applyDetail = useCallback((detail: LiveProgramDetail) => {
    setDocument(detail.draftDocument);
    setBaseline(detail.draftDocument);
    setRevision(detail.draftRevision);
  }, []);

  const handleConflict = useCallback((error: unknown) => {
    const parsed = parseLiveProgramRevisionConflict(error);
    if (parsed !== null) {
      setConflict(parsed);
    }
  }, []);

  const updateDocument = useCallback(
    (updater: (document: LiveProgramDocument) => LiveProgramDocument) => {
      setDocument((current) => updater(current));
    },
    [],
  );

  const save = useCallback(() => {
    if (blockedByDraftIssues || !dirty) {
      return;
    }
    saveMutation.mutate(buildSaveDraftRequest(revision, document), {
      onSuccess: (detail) => applyDetail(detail),
      onError: handleConflict,
    });
  }, [
    applyDetail,
    blockedByDraftIssues,
    dirty,
    document,
    handleConflict,
    revision,
    saveMutation,
  ]);

  const finalize = useCallback(
    (note: string) => {
      if (blockedByDraftIssues || dirty) {
        return;
      }
      finalizeMutation.mutate(buildFinalizeVersionRequest(revision, note), {
        onSuccess: (version) => setLastFinalizedVersion(version),
        onError: handleConflict,
      });
    },
    [
      blockedByDraftIssues,
      dirty,
      finalizeMutation,
      handleConflict,
      revision,
    ],
  );

  const restoreVersion = useCallback(
    (versionId: string) => {
      if (blockedByDraftIssues || dirty) {
        return;
      }
      restoreMutation.mutate(
        {
          versionId,
          request: buildRestoreVersionDraftRequest(revision),
        },
        {
          onSuccess: (detail) => applyDetail(detail),
          onError: handleConflict,
        },
      );
    },
    [
      applyDetail,
      blockedByDraftIssues,
      dirty,
      handleConflict,
      restoreMutation,
      revision,
    ],
  );

  const importMaterial = useCallback(
    (input: Omit<ImportLiveMaterialRequest, "expectedRevision">) => {
      if (blockedByDraftIssues || dirty) {
        return;
      }
      importMutation.mutate(
        { ...input, expectedRevision: revision },
        {
          onSuccess: (result) => applyDetail(result.program),
          onError: handleConflict,
        },
      );
    },
    [
      applyDetail,
      blockedByDraftIssues,
      dirty,
      handleConflict,
      importMutation,
      revision,
    ],
  );

  const reloadConflict = useCallback(() => {
    if (conflict === null) {
      return;
    }
    setDocument(conflict.currentDocument);
    setBaseline(conflict.currentDocument);
    setRevision(conflict.currentRevision);
    saveMutation.reset();
    finalizeMutation.reset();
    restoreMutation.reset();
    importMutation.reset();
    setConflict(null);
  }, [
    conflict,
    finalizeMutation,
    importMutation,
    restoreMutation,
    saveMutation,
  ]);

  return {
    document,
    revision,
    dirty,
    blockedByDraftIssues,
    conflict,
    lastFinalizedVersion,
    updateDocument,
    dismissConflict: () => setConflict(null),
    reloadConflict,
    save,
    finalize,
    restoreVersion,
    importMaterial,
    saveMutation,
    finalizeMutation,
    restoreMutation,
    importMutation,
  };
}
