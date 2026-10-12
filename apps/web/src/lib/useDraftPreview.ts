import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  draftPreviewSchema,
  type ContentDocument,
  type DraftPreview,
  type PreviewTimeline,
  type ScriptVersionPreview,
} from "@kakeai/contracts";
import { apiRequest } from "../api/client";

export interface UnsavedDocumentState {
  dirty: boolean;
  document: ContentDocument | null;
}

export interface ActivePreview {
  identity: string;
  source: "saved" | "draft";
  compositionHtml: string;
  timeline: PreviewTimeline | undefined;
  assetsCount: number;
}

export interface DraftPreviewSlot {
  data: DraftPreview | null;
  error: unknown;
  isPending: boolean;
  unreflected: boolean;
  canRetry: boolean;
  seq: number;
  retry: () => void;
}

export function draftDocumentKey(document: ContentDocument | null): string | null {
  return document === null ? null : JSON.stringify(document);
}

export function isDraftUnreflected(
  dirty: boolean,
  pending: boolean,
  document: ContentDocument | null,
  appliedKey: string | null,
): boolean {
  if (!dirty) {
    return false;
  }
  if (pending) {
    return true;
  }
  if (document === null) {
    return true;
  }
  return draftDocumentKey(document) !== appliedKey;
}

export function selectActivePreview(
  saved: ScriptVersionPreview | undefined,
  draft: DraftPreview | null,
  draftSeq: number,
): ActivePreview | undefined {
  if (draft !== null) {
    return {
      identity: `draft:${draftSeq}`,
      source: "draft",
      compositionHtml: draft.compositionHtml,
      timeline: draft.timeline,
      assetsCount: draft.assets.length,
    };
  }
  if (saved === undefined) {
    return undefined;
  }
  return {
    identity: saved.scriptVersionId,
    source: "saved",
    compositionHtml: saved.compositionHtml,
    timeline: saved.timeline,
    assetsCount: saved.assets.length,
  };
}

export async function requestDraftPreview(
  editionId: string,
  document: ContentDocument,
  signal?: AbortSignal,
): Promise<DraftPreview> {
  const response = await apiRequest<DraftPreview>(
    `/language-editions/${encodeURIComponent(editionId)}/draft-preview`,
    { method: "POST", body: { content: document }, signal },
  );
  const parsed = draftPreviewSchema.safeParse(response.data);
  if (!parsed.success) {
    throw new Error("プレビュー応答を解釈できませんでした。");
  }
  return parsed.data;
}

export function useDraftPreview(
  editionId: string | undefined,
  unsaved: UnsavedDocumentState,
): DraftPreviewSlot {
  const [data, setData] = useState<DraftPreview | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [isPending, setIsPending] = useState(false);
  const [appliedKey, setAppliedKey] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [seq, setSeq] = useState(0);
  const seqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const document = unsaved.document;
  const key = useMemo(() => draftDocumentKey(document), [document]);

  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (!unsaved.dirty) {
      seqRef.current += 1;
      setData(null);
      setError(null);
      setIsPending(false);
      setAppliedKey(null);
      return;
    }
    if (editionId === undefined || editionId === "" || key === null || document === null) {
      setIsPending(false);
      return;
    }
    const requestSeq = seqRef.current + 1;
    seqRef.current = requestSeq;
    const controller = new AbortController();
    abortRef.current = controller;
    setIsPending(true);
    setError(null);
    requestDraftPreview(editionId, document, controller.signal)
      .then((preview) => {
        if (seqRef.current !== requestSeq) {
          return;
        }
        abortRef.current = null;
        setData(preview);
        setError(null);
        setIsPending(false);
        setAppliedKey(key);
        setSeq(requestSeq);
      })
      .catch((requestError: unknown) => {
        if (controller.signal.aborted || seqRef.current !== requestSeq) {
          return;
        }
        abortRef.current = null;
        setError(requestError);
        setIsPending(false);
      });
    return () => {
      controller.abort();
    };
  }, [editionId, unsaved.dirty, key, retryToken]);

  const retry = useCallback(() => {
    setRetryToken((token) => token + 1);
  }, []);

  const unreflected = isDraftUnreflected(unsaved.dirty, isPending, document, appliedKey);
  const canRetry = unsaved.dirty && key !== null;

  return useMemo<DraftPreviewSlot>(
    () => ({ data, error, isPending, unreflected, canRetry, seq, retry }),
    [data, error, isPending, unreflected, canRetry, seq, retry],
  );
}
