import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type {
  LiveProgramDetail,
  LiveProgramDocument,
  LiveProgramSegment,
} from "@kakeai/contracts";
import {
  useAssets,
  useLiveFormats,
  useLiveMaterials,
} from "../../api/hooks";
import { errorMessage } from "../../lib/errorMessage";
import { liveFormatsRoute, liveProgramsRoute } from "../../lib/routes";
import {
  badgeDangerClass,
  badgeNeutralClass,
  badgeSuccessClass,
  badgeWarningClass,
  buttonNeutralClass,
  buttonPrimaryClass,
  errorTextClass,
  metaTextClass,
  warningTextClass,
} from "../../ui";
import { useLiveProgramEditor } from "../editor/useLiveProgramEditor";
import { LIVE_CUE_EXPRESSION_OPTIONS } from "../model/cues";
import { createLiveLocalId } from "../model/ids";
import { addCutIn, removeCutIn } from "../model/cutins";
import { addCutInSegment, cuesOfSegment } from "../model/segments";
import {
  addCardToDocument,
  removeCardFromDocument,
  removeCardStateFromDocument,
  replaceCardInDocument,
} from "../model/cards";
import {
  draftValidationIssues,
  versionValidationIssues,
} from "../model/validation";
import { parseLiveProgramServerIssues } from "../model/version-actions";
import {
  resolveEffectiveVisual,
  segmentDefaultVisual,
  type EffectiveVisual,
} from "../model/visual";
import { AddCutInDialog } from "../components/AddCutInDialog";
import { CardLibraryPanel } from "../components/CardLibraryPanel";
import { ConflictDialog } from "../components/ConflictDialog";
import { CueEditor } from "../components/CueEditor";
import { CueList } from "../components/CueList";
import { FinalizeDialog } from "../components/FinalizeDialog";
import { FormatProvenanceBanner } from "../components/FormatProvenanceBanner";
import { LivePreview } from "../components/LivePreview";
import { MaterialImportDialog } from "../components/MaterialImportDialog";
import { MaterialsPanel } from "../components/MaterialsPanel";
import { ProgramSettingsPanel } from "../components/ProgramSettingsPanel";
import { SegmentEditor } from "../components/SegmentEditor";
import { SegmentList } from "../components/SegmentList";
import { ValidationIssues } from "../components/ValidationIssues";
import { VersionDiffPanel } from "../components/VersionDiffPanel";
import { VersionsPanel } from "../components/VersionsPanel";

type RightTab = "preview" | "cards" | "materials" | "versions" | "diff" | "settings";

const TABS: { id: RightTab; label: string }[] = [
  { id: "preview", label: "プレビュー" },
  { id: "cards", label: "カード" },
  { id: "materials", label: "素材・CutIn" },
  { id: "versions", label: "版" },
  { id: "diff", label: "差分" },
  { id: "settings", label: "設定" },
];

function cueSegmentOf(segment: LiveProgramSegment | null) {
  if (segment === null) {
    return null;
  }
  return segment.kind === "opening" || segment.kind === "script" || segment.kind === "closing"
    ? segment
    : null;
}

function editorVisual(
  segment: LiveProgramSegment | null,
  cue: LiveProgramDocument["cues"][number] | null,
): EffectiveVisual | null {
  if (segment === null) {
    return null;
  }
  if (cue === null) {
    const visual = segmentDefaultVisual(segment);
    return visual === null
      ? { visual: null, source: "none" }
      : { visual, source: "segment" };
  }
  return resolveEffectiveVisual(segment, cue);
}

export function LiveProgramEditor({ initial }: { initial: LiveProgramDetail }) {
  const editor = useLiveProgramEditor(initial);
  const { document } = editor;
  const assetsQuery = useAssets();
  const materialsQuery = useLiveMaterials(initial.id);
  const formatsQuery = useLiveFormats();

  const assets = assetsQuery.data ?? [];
  const audioAssets = useMemo(
    () => assets.filter((asset) => asset.kind === "audio" && asset.status === "ready"),
    [assets],
  );
  const videoAssets = useMemo(
    () => assets.filter((asset) => asset.kind === "video" && asset.status === "ready"),
    [assets],
  );
  const imageAssets = useMemo(
    () => assets.filter((asset) => asset.kind === "image" && asset.status === "ready"),
    [assets],
  );

  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(
    document.segments[0]?.id ?? null,
  );
  const [selectedCueId, setSelectedCueId] = useState<string | null>(
    cueSegmentOf(document.segments[0] ?? null)?.cues[0] ?? null,
  );
  const [tab, setTab] = useState<RightTab>("preview");
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [addCutInOpen, setAddCutInOpen] = useState(false);
  const [cutInError, setCutInError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [diffVersionId, setDiffVersionId] = useState<string | null>(null);

  const selectedSegment =
    document.segments.find((segment) => segment.id === selectedSegmentId) ??
    document.segments[0] ??
    null;
  const selectedCueSegment = cueSegmentOf(selectedSegment);
  const segmentCues =
    selectedCueSegment === null ? [] : cuesOfSegment(document, selectedCueSegment);
  const selectedCue =
    segmentCues.find((cue) => cue.id === selectedCueId) ?? segmentCues[0] ?? null;

  useEffect(() => {
    if (document.segments.length === 0) {
      setSelectedSegmentId(null);
      setSelectedCueId(null);
      return;
    }
    if (!document.segments.some((segment) => segment.id === selectedSegmentId)) {
      setSelectedSegmentId(document.segments[0]!.id);
    }
  }, [document.segments, selectedSegmentId]);

  useEffect(() => {
    if (selectedCueSegment === null) {
      setSelectedCueId(null);
      return;
    }
    if (!selectedCueSegment.cues.includes(selectedCueId ?? "")) {
      setSelectedCueId(selectedCueSegment.cues[0] ?? null);
    }
  }, [selectedCueId, selectedCueSegment]);

  useEffect(() => {
    if (editor.lastFinalizedVersion !== null) {
      setFinalizeOpen(false);
      setTab("versions");
    }
  }, [editor.lastFinalizedVersion]);

  useEffect(() => {
    if (editor.importMutation.isSuccess) {
      setImportOpen(false);
    }
  }, [editor.importMutation.isSuccess]);

  useEffect(() => {
    if (editor.conflict !== null) {
      setFinalizeOpen(false);
      setImportOpen(false);
      setAddCutInOpen(false);
    }
  }, [editor.conflict]);

  const draftIssues = useMemo(
    () => draftValidationIssues(document).slice(0, 12),
    [document],
  );
  const versionIssues = useMemo(() => versionValidationIssues(document), [document]);
  const segmentIndex = selectedSegment === null ? -1 : document.segments.indexOf(selectedSegment);
  const cueIndex =
    selectedCue === null ? -1 : document.cues.findIndex((cue) => cue.id === selectedCue.id);
  const segmentIssues = versionIssues.filter(
    (issue) => issue.path[0] === "segments" && issue.path[1] === segmentIndex,
  );
  const cueIssues = versionIssues.filter(
    (issue) => issue.path[0] === "cues" && issue.path[1] === cueIndex,
  );

  const effective = editorVisual(selectedSegment, selectedCue);
  const effectiveVisual = effective?.visual ?? null;
  const effectiveSource = effective?.source ?? "none";
  // null means an explicit hide; undefined means there is nothing to show.
  const previewVisual = effectiveSource === "none" ? undefined : effectiveVisual;
  const segmentPreviewVisual =
    selectedSegment === null || selectedSegment.kind === "cut_in"
      ? undefined
      : selectedSegment.visual;
  const focusVisual =
    effectiveVisual !== null && effectiveVisual.kind === "card"
      ? { cardId: effectiveVisual.cardId, stateId: effectiveVisual.stateId }
      : null;
  const formatName = formatsQuery.data?.items.find(
    (format) => format.id === initial.sourceFormat?.formatId,
  )?.name;

  const selectSegment = (segmentId: string) => {
    setSelectedSegmentId(segmentId);
    const segment = document.segments.find((entry) => entry.id === segmentId);
    setSelectedCueId(cueSegmentOf(segment ?? null)?.cues[0] ?? null);
  };

  const handleAddCutIn = (input: { label: string; cutInId?: string; assetId?: string }) => {
    const existingCutIn =
      input.cutInId === undefined
        ? undefined
        : document.cutIns.find((entry) => entry.id === input.cutInId);
    if (input.cutInId !== undefined && existingCutIn === undefined) {
      setCutInError("選択したCutInが見つかりません。ダイアログを開き直してください。");
      return;
    }
    if (
      existingCutIn !== undefined &&
      !videoAssets.some((asset) => asset.id === existingCutIn.assetId)
    ) {
      setCutInError("選択したCutInの動画Assetが見つかりません。");
      return;
    }
    if (
      input.assetId !== undefined &&
      !videoAssets.some((asset) => asset.id === input.assetId)
    ) {
      setCutInError("選択した動画Assetは利用できません（ready な動画のみ使えます）。");
      return;
    }
    if (input.cutInId === undefined && input.assetId === undefined) {
      setCutInError("CutInまたは動画Assetを選択してください。");
      return;
    }
    setCutInError(null);
    const segmentId = createLiveLocalId("seg");
    const newCutInId = createLiveLocalId("cut");
    editor.updateDocument((current) => {
      const cutInId = input.cutInId ?? newCutInId;
      const withCutIn =
        input.cutInId === undefined && input.assetId !== undefined
          ? addCutIn(current, { id: cutInId, assetId: input.assetId })
          : current;
      return addCutInSegment(withCutIn, {
        id: segmentId,
        label: input.label,
        cutInId,
      });
    });
    setAddCutInOpen(false);
    setSelectedSegmentId(segmentId);
  };

  const handleRestoreVersion = (versionId: string) => {
    if (
      window.confirm(
        "この版の内容を現在の下書きへ複製しますか？現在の下書きは上書きされます（版は変更されません）。",
      )
    ) {
      editor.restoreVersion(versionId);
    }
  };

  return (
    <div className="mx-auto max-w-[1800px] space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link to={liveProgramsRoute()} className="text-sm text-brand-700 hover:underline">
              ← ライブプログラム一覧
            </Link>
            <Link to={liveFormatsRoute()} className="text-sm text-brand-700 hover:underline">
              フォーマット
            </Link>
          </div>
          <h1 className="mt-1 break-words text-2xl font-bold">{document.title}</h1>
          <p className={metaTextClass}>
            リビジョン {editor.revision} / セグメント {document.segments.length}件 / Cue{" "}
            {document.cues.length}件 / カード {document.cards.length}件
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {editor.dirty ? (
            <span className={badgeWarningClass}>未保存の変更あり</span>
          ) : (
            <span className={badgeSuccessClass}>保存済み</span>
          )}
          {editor.blockedByDraftIssues && (
            <span className={badgeDangerClass}>検証エラーあり</span>
          )}
          <button
            type="button"
            className={buttonPrimaryClass}
            disabled={
              !editor.dirty ||
              editor.blockedByDraftIssues ||
              editor.saveMutation.isPending
            }
            onClick={editor.save}
          >
            {editor.saveMutation.isPending ? "保存中…" : "下書きを保存"}
          </button>
          <button
            type="button"
            className={buttonNeutralClass}
            disabled={editor.dirty || editor.blockedByDraftIssues}
            onClick={() => {
              editor.finalizeMutation.reset();
              setFinalizeOpen(true);
            }}
          >
            版を確定
          </button>
        </div>
      </div>

      <FormatProvenanceBanner
        sourceFormat={initial.sourceFormat}
        formatName={formatName}
      />

      {editor.lastFinalizedVersion !== null && (
        <p className="rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900 dark:border-green-800 dark:bg-green-950/40 dark:text-green-100">
          版 v{editor.lastFinalizedVersion.versionNumber} を確定しました。
        </p>
      )}

      {editor.saveMutation.isError && (
        <div className="rounded border border-red-300 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950/30">
          <p className={errorTextClass}>{errorMessage(editor.saveMutation.error)}</p>
          <ValidationIssues
            issues={parseLiveProgramServerIssues(editor.saveMutation.error)}
          />
        </div>
      )}

      {draftIssues.length > 0 && (
        <div className="rounded border border-red-300 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950/30">
          <p className="m-0 mb-1 text-sm font-semibold text-red-700 dark:text-red-300">
            保存前の検証エラー（{draftIssues.length}件）
          </p>
          <ValidationIssues issues={draftIssues} />
        </div>
      )}

      <div className="grid gap-3 xl:grid-cols-[minmax(240px,300px)_minmax(0,1fr)_minmax(320px,460px)]">
        <div className="space-y-3">
          <SegmentList
            document={document}
            selectedSegmentId={selectedSegment?.id ?? null}
            onSelect={selectSegment}
            onChangeDocument={editor.updateDocument}
            onRequestAddCutIn={() => {
              setCutInError(null);
              setAddCutInOpen(true);
            }}
          />
        </div>

        <div className="min-w-0 space-y-3">
          {selectedSegment === null ? (
            <p className={metaTextClass}>セグメントがありません。</p>
          ) : (
            <>
              <SegmentEditor
                document={document}
                segment={selectedSegment}
                issues={segmentIssues}
                onChangeDocument={editor.updateDocument}
              />
              <CueList
                document={document}
                segment={selectedSegment}
                selectedCueId={selectedCue?.id ?? null}
                onSelectCue={setSelectedCueId}
                onChangeDocument={editor.updateDocument}
              />
              {selectedCueSegment !== null && selectedCue !== null && (
                <CueEditor
                  document={document}
                  segment={selectedCueSegment}
                  cue={selectedCue}
                  audioAssets={audioAssets}
                  expressionOptions={[...LIVE_CUE_EXPRESSION_OPTIONS]}
                  issues={cueIssues}
                  onChangeDocument={editor.updateDocument}
                />
              )}
            </>
          )}
        </div>

        <aside className="min-w-0">
          <div className="mb-2 flex flex-wrap gap-1">
            {TABS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={`rounded border px-2 py-1 text-xs ${
                  tab === entry.id
                    ? "border-brand-500 bg-brand-50 font-semibold dark:bg-brand-950/30"
                    : "border-border bg-surface text-muted-foreground"
                }`}
                onClick={() => setTab(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </div>

          {tab === "preview" && (
            <div className="space-y-3">
              <section className="rounded-lg border border-border bg-surface p-3">
                <h2 className="m-0 mb-2 text-base font-semibold">選択中Cueのプレビュー</h2>
                <LivePreview
                  document={document}
                  visual={previewVisual}
                  sourceLabel={
                    effectiveSource === "cue"
                      ? "Cue指定"
                      : effectiveSource === "segment"
                        ? "Segment既定"
                        : "表示なし"
                  }
                />
              </section>
              <section className="rounded-lg border border-border bg-surface p-3">
                <h2 className="m-0 mb-2 text-base font-semibold">セグメント既定</h2>
                <LivePreview
                  document={document}
                  visual={segmentPreviewVisual}
                  replayable={false}
                />
              </section>
              <p className={metaTextClass}>
                初回表示は完成状態で描画し、アニメーションは再生しません。「アニメーションを再生」で入場演出だけ確認できます。素材カードは書き出し時に解決されます。
              </p>
            </div>
          )}

          {tab === "cards" && (
            <CardLibraryPanel
              cards={document.cards}
              imageAssets={imageAssets}
              focusVisual={focusVisual}
              onAddCard={(card) =>
                editor.updateDocument((current) => addCardToDocument(current, card))
              }
              onUpdateCard={(card) =>
                editor.updateDocument((current) => replaceCardInDocument(current, card))
              }
              onRemoveCard={(cardId) => {
                if (
                  window.confirm(
                    "カードを削除しますか？参照しているビジュアルは継承に戻ります。",
                  )
                ) {
                  editor.updateDocument((current) => removeCardFromDocument(current, cardId));
                }
              }}
              onRemoveState={(cardId, stateId) =>
                editor.updateDocument((current) =>
                  removeCardStateFromDocument(current, cardId, stateId),
                )
              }
            />
          )}

          {tab === "materials" && (
            <MaterialsPanel
              document={document}
              materials={materialsQuery.data?.items ?? []}
              videoAssets={videoAssets}
              canImport={!editor.dirty && !editor.blockedByDraftIssues}
              importPending={editor.importMutation.isPending}
              importError={editor.importMutation.error}
              onRequestImport={() => {
                editor.importMutation.reset();
                setImportOpen(true);
              }}
              onChangeDocument={editor.updateDocument}
            />
          )}

          {tab === "versions" && (
            <VersionsPanel
              programId={initial.id}
              dirty={editor.dirty}
              highlightVersionId={editor.lastFinalizedVersion?.id ?? null}
              restorePending={editor.restoreMutation.isPending}
              restoreError={editor.restoreMutation.error}
              onRestore={(version) => handleRestoreVersion(version.id)}
              onShowDiff={(version) => {
                setDiffVersionId(version.id);
                setTab("diff");
              }}
            />
          )}

          {tab === "diff" && (
            <VersionDiffPanel
              programId={initial.id}
              draft={document}
              selectedVersionId={diffVersionId}
              onSelectVersion={setDiffVersionId}
            />
          )}

          {tab === "settings" && (
            <ProgramSettingsPanel
              document={document}
              onChangeDocument={editor.updateDocument}
            />
          )}
        </aside>
      </div>

      <FinalizeDialog
        open={finalizeOpen}
        dirty={editor.dirty}
        blockedByDraftIssues={editor.blockedByDraftIssues}
        versionIssues={versionIssues}
        isPending={editor.finalizeMutation.isPending}
        error={editor.finalizeMutation.error}
        onClose={() => setFinalizeOpen(false)}
        onSubmit={editor.finalize}
      />

      <ConflictDialog
        conflict={editor.conflict}
        onReload={editor.reloadConflict}
        onClose={editor.dismissConflict}
      />

      <AddCutInDialog
        open={addCutInOpen}
        document={document}
        videoAssets={videoAssets}
        error={cutInError}
        onClose={() => setAddCutInOpen(false)}
        onAdd={handleAddCutIn}
      />

      <MaterialImportDialog
        open={importOpen}
        isPending={editor.importMutation.isPending}
        error={editor.importMutation.error}
        onClose={() => setImportOpen(false)}
        onImport={(input) => {
          if (editor.importMutation.isError) {
            editor.importMutation.reset();
          }
          editor.importMaterial(input);
        }}
      />
    </div>
  );
}
