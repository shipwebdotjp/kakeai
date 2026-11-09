import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  liveFormatDocumentV1Schema,
  type LiveFormatDetail,
  type LiveFormatDocumentV1,
} from "@kakeai/contracts";
import {
  useAssets,
  useCharacters,
  useThemes,
  useUpdateLiveFormat,
  useVoiceProfiles,
} from "../../api/hooks";
import { errorMessage } from "../../lib/errorMessage";
import { liveFormatsRoute } from "../../lib/routes";
import {
  badgeSuccessClass,
  badgeWarningClass,
  buttonPrimaryClass,
  errorTextClass,
  metaTextClass,
} from "../../ui";
import { stableJson } from "../model/canonical";
import {
  addFormatCard,
  removeFormatCard,
  removeFormatCardState,
  replaceFormatCard,
} from "../model/format";
import type { LiveProgramServerIssue } from "../model/version-actions";
import { canAdoptExternalFormatDocument } from "../model/format-sync";
import { CardLibraryPanel } from "../components/CardLibraryPanel";
import { ValidationIssues } from "../components/ValidationIssues";
import { FormatBasicsFields } from "../components/format/FormatBasicsFields";
import { FormatCueFields } from "../components/format/FormatCueFields";
import { FormatPolicyFields } from "../components/format/FormatPolicyFields";
import { FormatSpineEditor } from "../components/format/FormatSpineEditor";
import type { ThemeOption } from "../components/CastFields";

export function LiveFormatEditor({ initial }: { initial: LiveFormatDetail }) {
  const [document, setDocument] = useState<LiveFormatDocumentV1>(initial.document);
  const [baseline, setBaseline] = useState<LiveFormatDocumentV1>(initial.document);
  const initialDocumentRef = useRef(initial.document);
  const updateFormat = useUpdateLiveFormat(initial.id);
  const themesQuery = useThemes();
  const charactersQuery = useCharacters();
  const voicesQuery = useVoiceProfiles();
  const assetsQuery = useAssets();

  useEffect(() => {
    if (initialDocumentRef.current === initial.document) {
      return;
    }
    if (!canAdoptExternalFormatDocument(document, baseline)) {
      // Keep the ref stale so a later save can still pick up the latest prop.
      return;
    }
    initialDocumentRef.current = initial.document;
    setDocument(initial.document);
    setBaseline(initial.document);
  }, [baseline, document, initial.document]);

  const dirty = useMemo(
    () => stableJson(document) !== stableJson(baseline),
    [document, baseline],
  );
  const imageAssets = (assetsQuery.data ?? []).filter(
    (asset) => asset.kind === "image" && asset.status === "ready",
  );
  const themes: ThemeOption[] =
    themesQuery.data
      ?.filter((theme) => theme.latestRevision !== null && theme.archivedAt === null)
      .map((theme) => ({
        id: theme.id,
        name: theme.name,
        version: theme.latestRevision?.version ?? 1,
      })) ?? [];

  const issues: LiveProgramServerIssue[] = useMemo(() => {
    const parsed = liveFormatDocumentV1Schema.safeParse(document);
    if (parsed.success) {
      return [];
    }
    return parsed.error.issues.map((issue) => ({
      path: issue.path.filter(
        (entry): entry is string | number =>
          typeof entry === "string" || typeof entry === "number",
      ),
      code: issue.code,
      message: issue.message,
    }));
  }, [document]);

  const updateDocument = (
    updater: (current: LiveFormatDocumentV1) => LiveFormatDocumentV1,
  ) => setDocument((current) => updater(current));

  const save = () => {
    if (!dirty || issues.length > 0) {
      return;
    }
    updateFormat.mutate(
      { document },
      {
        onSuccess: (detail) => {
          setDocument(detail.document);
          setBaseline(detail.document);
        },
      },
    );
  };

  return (
    <div className="mx-auto max-w-6xl space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to={liveFormatsRoute()} className="text-sm text-brand-700 hover:underline">
            ← ライブフォーマット一覧
          </Link>
          <h1 className="mt-1 text-2xl font-bold">{document.name}</h1>
          <p className={metaTextClass}>
            セグメント {document.segments.length}件 / カード {document.cards.length}件 / 汎用Cue{" "}
            {document.cues.length}件
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {dirty ? (
            <span className={badgeWarningClass}>未保存の変更あり</span>
          ) : (
            <span className={badgeSuccessClass}>保存済み</span>
          )}
          <button
            type="button"
            className={buttonPrimaryClass}
            disabled={!dirty || issues.length > 0 || updateFormat.isPending}
            onClick={save}
          >
            {updateFormat.isPending ? "保存中…" : "フォーマットを保存"}
          </button>
        </div>
      </div>

      <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
        このフォーマットを編集しても、既存のライブプログラムには反映されません。以後に作成するプログラムにだけ適用されます。
      </div>

      {updateFormat.isError && (
        <p className={errorTextClass}>{errorMessage(updateFormat.error)}</p>
      )}
      {issues.length > 0 && (
        <div className="rounded border border-red-300 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950/30">
          <p className="m-0 mb-1 text-sm font-semibold text-red-700 dark:text-red-300">
            保存前の検証エラー（{issues.length}件）
          </p>
          <ValidationIssues issues={issues} />
        </div>
      )}

      {themesQuery.isError && (
        <p className={errorTextClass}>{errorMessage(themesQuery.error)}</p>
      )}
      {charactersQuery.isError && (
        <p className={errorTextClass}>{errorMessage(charactersQuery.error)}</p>
      )}
      {voicesQuery.isError && (
        <p className={errorTextClass}>{errorMessage(voicesQuery.error)}</p>
      )}

      <FormatBasicsFields
        document={document}
        themes={themes}
        characters={charactersQuery.data ?? []}
        voices={voicesQuery.data ?? []}
        onChangeDocument={updateDocument}
      />

      <FormatSpineEditor document={document} onChangeDocument={updateDocument} />

      <FormatCueFields document={document} onChangeDocument={updateDocument} />

      <CardLibraryPanel
        cards={document.cards}
        imageAssets={imageAssets}
        focusVisual={null}
        onAddCard={(card) =>
          setDocument((current) => addFormatCard(current, card))
        }
        onUpdateCard={(card) =>
          setDocument((current) => replaceFormatCard(current, card))
        }
        onRemoveCard={(cardId) => {
          if (
            window.confirm(
              "カードを削除しますか？このカードを参照するセグメント既定ビジュアルは削除されます。",
            )
          ) {
            setDocument((current) => removeFormatCard(current, cardId));
          }
        }}
        onRemoveState={(cardId, stateId) =>
          setDocument((current) => removeFormatCardState(current, cardId, stateId))
        }
      />

      <FormatPolicyFields document={document} onChangeDocument={updateDocument} />
    </div>
  );
}
