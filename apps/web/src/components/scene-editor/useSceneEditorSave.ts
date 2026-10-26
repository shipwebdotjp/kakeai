import { useEffect, useState } from "react";
import type { UseFormHandleSubmit, UseFormReset } from "react-hook-form";
import {
  contentDocumentSchema,
  type ContentDocument,
  type ScriptVersion,
  type Warning,
} from "@kakeai/contracts";
import { ApiError } from "../../api/client";
import { useSaveScriptVersion } from "../../api/hooks";
import type { Diagnostic } from "../../content/diagnostics";
import {
  buildContentDocument,
  toFormValues,
  type DocumentFormValues,
} from "../../content/form";
import { errorMessage } from "../../lib/errorMessage";

function extractServerErrors(error: unknown): Diagnostic[] {
  if (
    error instanceof ApiError &&
    error.details &&
    typeof error.details === "object" &&
    "issues" in error.details &&
    Array.isArray((error.details as { issues: unknown }).issues)
  ) {
    return (
      error.details as {
        issues: {
          path?: (string | number)[];
          code?: string;
          message: string;
        }[];
      }
    ).issues.map((issue) => ({
      path: issue.path,
      code: issue.code,
      message: issue.message ?? "入力エラーが発生しました",
    }));
  }
  return [{ message: errorMessage(error) }];
}

export interface SceneEditorSaveOptions {
  base: ContentDocument;
  editionId: string;
  handleSubmit: UseFormHandleSubmit<DocumentFormValues>;
  reset: UseFormReset<DocumentFormValues>;
  clearBulkResult: () => void;
  onSaved?: (scriptVersion: ScriptVersion) => void;
}

export function useSceneEditorSave({
  base,
  editionId,
  handleSubmit,
  reset,
  clearBulkResult,
  onSaved,
}: SceneEditorSaveOptions) {
  const save = useSaveScriptVersion(editionId);
  const [diagnostics, setDiagnostics] = useState<{
    errors: Diagnostic[];
    warnings: Diagnostic[];
  }>({
    errors: [],
    warnings: [],
  });
  const [openKind, setOpenKind] = useState<"error" | "warning" | null>(null);
  const [savedAtMs, setSavedAtMs] = useState<number | null>(null);

  useEffect(() => {
    if (savedAtMs === null) {
      return;
    }
    const timer = setTimeout(() => setSavedAtMs(null), 4000);
    return () => clearTimeout(timer);
  }, [savedAtMs]);

  const onSubmit = handleSubmit((values) => {
    let document: ContentDocument;
    try {
      document = buildContentDocument(base, values);
    } catch (error) {
      setDiagnostics({
        errors: [{ message: errorMessage(error) }],
        warnings: [],
      });
      setOpenKind("error");
      return;
    }
    const parsed = contentDocumentSchema.safeParse(document);
    if (!parsed.success) {
      setDiagnostics({
        errors: parsed.error.issues.map((issue) => ({
          path: issue.path as (string | number)[],
          code: issue.code,
          message: issue.message,
        })),
        warnings: [],
      });
      setOpenKind("error");
      return;
    }
    save.mutate(parsed.data, {
      onSuccess: (result) => {
        reset(toFormValues(result.scriptVersion.content));
        const warnings = result.warnings.map((warning) => ({
          path: warning.path,
          code: warning.code,
          message: warning.message,
        }));
        setDiagnostics({ errors: [], warnings });
        setOpenKind(warnings.length > 0 ? "warning" : null);
        setSavedAtMs(Date.now());
        clearBulkResult();
        onSaved?.(result.scriptVersion);
      },
      onError: (error) => {
        setDiagnostics((prev) => ({
          ...prev,
          errors: extractServerErrors(error),
        }));
        setOpenKind("error");
      },
    });
  });

  const showMessage = (message: string): void => {
    setDiagnostics((prev) => ({ ...prev, errors: [{ message }] }));
    setOpenKind("error");
  };

  const showError = (error: unknown): void => {
    showMessage(errorMessage(error));
  };

  const showWarnings = (warnings: Warning[]): void => {
    setDiagnostics((prev) => ({
      ...prev,
      warnings: warnings.map((warning) => ({
        path: warning.path,
        code: warning.code,
        message: warning.message,
      })),
    }));
    if (warnings.length > 0) {
      setOpenKind("warning");
      return;
    }
    setOpenKind((prev) => (prev === "warning" ? null : prev));
  };

  return {
    save,
    diagnostics,
    setDiagnostics,
    openKind,
    setOpenKind,
    savedAtMs,
    onSubmit,
    showMessage,
    showError,
    showWarnings,
  };
}
