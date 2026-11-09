import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { LiveProgramVersionSummary } from "@kakeai/contracts";
import { liveRunNewRoute } from "../../lib/routes";
import {
  useLiveProgramVersion,
  useLiveProgramVersions,
} from "../../api/hooks";
import { errorMessage } from "../../lib/errorMessage";
import { formatDateTime } from "../duration";
import {
  badgeInfoClass,
  badgeNeutralClass,
  buttonNeutralClass,
  buttonPrimaryClass,
  errorTextClass,
  metaTextClass,
  sectionTitleClass,
  warningTextClass,
} from "../../ui";

interface VersionsPanelProps {
  programId: string;
  dirty: boolean;
  highlightVersionId: string | null;
  restorePending: boolean;
  restoreError: unknown;
  onRestore: (version: LiveProgramVersionSummary) => void;
  onShowDiff: (version: LiveProgramVersionSummary) => void;
}

export function VersionsPanel({
  programId,
  dirty,
  highlightVersionId,
  restorePending,
  restoreError,
  onRestore,
  onShowDiff,
}: VersionsPanelProps) {
  const versionsQuery = useLiveProgramVersions(programId);
  const versions = versionsQuery.data ?? [];
  const sortedVersions = useMemo(
    () => [...versions].sort((left, right) => right.versionNumber - left.versionNumber),
    [versions],
  );
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [appliedHighlight, setAppliedHighlight] = useState<string | null>(null);
  // Depend on the id list, not the array identity: a refetch must not clobber
  // the user's selection.
  const versionIdsKey = JSON.stringify(sortedVersions.map((version) => version.id));

  useEffect(() => {
    const versionIds = JSON.parse(versionIdsKey) as string[];
    if (versionIds.length === 0) {
      return;
    }
    if (highlightVersionId !== null && appliedHighlight !== highlightVersionId) {
      setSelectedVersionId(highlightVersionId);
      setAppliedHighlight(highlightVersionId);
      return;
    }
    if (selectedVersionId === null || !versionIds.includes(selectedVersionId)) {
      setSelectedVersionId(versionIds[0] ?? null);
    }
  }, [
    appliedHighlight,
    highlightVersionId,
    selectedVersionId,
    versionIdsKey,
  ]);

  const detailQuery = useLiveProgramVersion(programId, selectedVersionId ?? undefined);
  const detail = detailQuery.data;

  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-border bg-surface p-3">
        <h2 className={sectionTitleClass}>版一覧</h2>
        <p className={metaTextClass}>
          確定済みの版は不変です。書き出しと配信開始はこの版から行います。
        </p>
        {versionsQuery.isLoading && <p className={metaTextClass}>版を読み込み中…</p>}
        {versionsQuery.isError && (
          <p className={errorTextClass}>{errorMessage(versionsQuery.error)}</p>
        )}
        {versionsQuery.isSuccess && versions.length === 0 && (
          <p className={metaTextClass}>まだ版がありません。</p>
        )}
        <ul className="m-0 mt-2 list-none space-y-1 p-0">
          {sortedVersions.map((version) => (
            <li
              key={version.id}
              className={`rounded border px-2 py-1 text-sm ${
                selectedVersionId === version.id
                  ? "border-brand-500 bg-brand-50 dark:bg-brand-950/30"
                  : "border-border"
              }`}
            >
              <button
                type="button"
                className="flex w-full flex-wrap items-center gap-2 text-left"
                onClick={() => setSelectedVersionId(version.id)}
              >
                <span className="font-semibold">v{version.versionNumber}</span>
                {highlightVersionId === version.id && (
                  <span className={badgeInfoClass}>今回確定</span>
                )}
                <span className={metaTextClass}>{formatDateTime(version.createdAt)}</span>
                {version.note !== null && (
                  <span className="min-w-0 flex-1 truncate">{version.note}</span>
                )}
              </button>
              <div className="mt-1 flex flex-wrap gap-1">
                <button
                  type="button"
                  className={buttonNeutralClass}
                  onClick={() => setSelectedVersionId(version.id)}
                >
                  詳細
                </button>
                <button
                  type="button"
                  className={buttonNeutralClass}
                  onClick={() => onShowDiff(version)}
                >
                  下書きとの差分
                </button>
                <button
                  type="button"
                  className={buttonPrimaryClass}
                  disabled={dirty || restorePending}
                  title={dirty ? "未保存の変更があるため複製できません" : undefined}
                  onClick={() => onRestore(version)}
                >
                  {restorePending ? "複製中…" : "この版を下書きに複製"}
                </button>
              </div>
            </li>
          ))}
        </ul>
        {dirty && (
          <p className={warningTextClass}>
            未保存の変更があります。版を下書きへ複製する前に保存してください。
          </p>
        )}
        {restoreError !== undefined && restoreError !== null && (
          <p className={errorTextClass}>{errorMessage(restoreError)}</p>
        )}
      </section>

      <section className="rounded-lg border border-border bg-surface p-3">
        <h2 className={sectionTitleClass}>版の詳細</h2>
        {selectedVersionId === null ? (
          <p className={metaTextClass}>版を選択してください。</p>
        ) : detailQuery.isLoading ? (
          <p className={metaTextClass}>版を読み込み中…</p>
        ) : detailQuery.isError ? (
          <p className={errorTextClass}>{errorMessage(detailQuery.error)}</p>
        ) : detail === undefined ? null : (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-lg font-semibold">v{detail.versionNumber}</span>
              <span className={badgeNeutralClass}>schema {detail.schemaVersion}</span>
              <span className={metaTextClass}>{formatDateTime(detail.createdAt)}</span>
            </div>
            {detail.note !== null && <p className="m-0">メモ: {detail.note}</p>}
            <dl className="m-0 grid grid-cols-2 gap-2">
              <div>
                <dt className={metaTextClass}>文書ハッシュ</dt>
                <dd className="m-0 break-all font-mono text-xs">{detail.documentSha256}</dd>
              </div>
              <div>
                <dt className={metaTextClass}>解決スナップショット</dt>
                <dd className="m-0 break-all font-mono text-xs">
                  {detail.resolutionSnapshotSha256}
                </dd>
              </div>
            </dl>

            <div>
              <h3 className="m-0 mb-1 text-sm font-semibold">解決スナップショット概要</h3>
              <ul className="m-0 list-none space-y-0.5 p-0 text-sm text-muted-foreground">
                <li>
                  テーマ: {detail.resolutionSnapshot.theme.id} v
                  {detail.resolutionSnapshot.theme.version}
                </li>
                <li>
                  キャラクター: {detail.resolutionSnapshot.characters.length}件（
                  {detail.resolutionSnapshot.characters
                    .map((character) => `${character.side}:${character.name}`)
                    .join(" / ")}
                  ）
                </li>
                <li>ボイス: {detail.resolutionSnapshot.voices.length}件</li>
                <li>音声Asset: {detail.resolutionSnapshot.audioAssets.length}件</li>
                <li>CutIn: {detail.resolutionSnapshot.cutIns.length}件</li>
                <li>Live Material: {detail.resolutionSnapshot.materials.length}件</li>
              </ul>
            </div>

            <div>
              <h3 className="m-0 mb-1 text-sm font-semibold">文書概要</h3>
              <p className="m-0 text-muted-foreground">
                {detail.document.title} / セグメント {detail.document.segments.length}件 / Cue{" "}
                {detail.document.cues.length}件 / カード {detail.document.cards.length}件 / 素材{" "}
                {detail.document.materials.length}件
              </p>
            </div>

            <div className="rounded-md border border-border bg-surface-muted p-2">
              <h3 className="m-0 mb-1 text-sm font-semibold">配信の準備</h3>
              <p className={metaTextClass}>
                この版から v2 パッケージを書き出し、Run を作成してアプリを起動します。
                「アプリ起動」と番組開始は別で、番組開始は Run のコンソールで行います。
              </p>
              <div className="flex flex-wrap gap-2">
                <Link
                  to={liveRunNewRoute({
                    programId,
                    programVersionId: detail.id,
                    mode: "export",
                  })}
                  className={buttonPrimaryClass}
                >
                  パッケージ書き出し
                </Link>
                <Link
                  to={liveRunNewRoute({
                    programId,
                    programVersionId: detail.id,
                  })}
                  className={buttonNeutralClass}
                >
                  アプリ起動（Run 作成）
                </Link>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
