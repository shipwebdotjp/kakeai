import { useMemo } from "react";
import type { LiveProgramDocument, LiveProgramVersionSummary } from "@kakeai/contracts";
import { useLiveProgramVersion, useLiveProgramVersions } from "../../api/hooks";
import { errorMessage } from "../../lib/errorMessage";
import {
  badgeDangerClass,
  badgeWarningClass,
  badgeSuccessClass,
  metaTextClass,
  sectionTitleClass,
} from "../../ui";
import {
  diffLiveProgramDocuments,
  type LiveProgramDiffArea,
  type LiveProgramDiffEntry,
} from "../model/diff";

const AREA_LABELS: Record<LiveProgramDiffArea, string> = {
  document: "番組設定",
  policy: "ポリシー",
  segment: "セグメント",
  cue: "Cue",
  card: "カード",
  cardState: "カード状態",
  visual: "中央ビジュアル",
  material: "素材",
  cutIn: "CutIn",
};

const FIELD_LABELS: Record<string, string> = {
  title: "タイトル",
  targetDurationMs: "目標尺",
  theme: "テーマ",
  cast: "キャスト",
  stageTemplate: "ステージ",
  commentPolicy: "コメント設定",
  safety: "安全設定",
  playout: "プレイアウト",
  label: "ラベル",
  kind: "種類",
  cues: "Cue構成",
  cutInId: "CutIn",
  order: "順序",
  speaker: "話者",
  caption: "字幕",
  speech: "読み上げ",
  expression: "表情",
  audioAssetId: "音声Asset",
  type: "種類",
  name: "名前",
  animation: "アニメーション",
  variant: "グラフ種類",
  chartAnimation: "グラフアニメーション",
  assetId: "Asset",
  asset: "Asset",
  items: "項目",
  activeItemId: "アクティブ項目",
  ordered: "番号付き",
  categories: "カテゴリ",
  series: "系列",
  unit: "単位",
  highlight: "強調",
  quote: "引用文",
  author: "著者",
  source: "出典",
  tone: "トーン",
  align: "揃え",
  subtitle: "サブタイトル",
  kicker: "キッカー",
  alt: "代替テキスト",
  credit: "クレジット",
  fit: "フィット",
  visual: "ビジュアル",
};

const CHANGE_LABELS = {
  added: "追加",
  removed: "削除",
  changed: "変更",
} as const;

function changeBadge(change: LiveProgramDiffEntry["change"]) {
  switch (change) {
    case "added":
      return badgeSuccessClass;
    case "removed":
      return badgeDangerClass;
    case "changed":
      return badgeWarningClass;
  }
}

function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

function entryLabel(entry: LiveProgramDiffEntry): string {
  if (entry.area === "visual" && entry.before !== undefined && entry.after !== undefined) {
    return `${entry.before} → ${entry.after}`;
  }
  if (entry.fields.length === 0) {
    return entry.id;
  }
  return entry.fields.map(fieldLabel).join(" / ");
}

interface VersionDiffPanelProps {
  programId: string;
  draft: LiveProgramDocument;
  selectedVersionId: string | null;
  onSelectVersion: (versionId: string | null) => void;
}

export function VersionDiffPanel({
  programId,
  draft,
  selectedVersionId,
  onSelectVersion,
}: VersionDiffPanelProps) {
  const versionsQuery = useLiveProgramVersions(programId);
  const versions = versionsQuery.data ?? [];
  const effectiveVersionId =
    selectedVersionId ?? versions[0]?.id ?? null;
  const detailQuery = useLiveProgramVersion(programId, effectiveVersionId ?? undefined);

  const version: LiveProgramVersionSummary | undefined = versions.find(
    (entry) => entry.id === effectiveVersionId,
  );
  const versionDocument = detailQuery.data?.document;
  const diff = useMemo(
    () =>
      versionDocument === undefined
        ? null
        : diffLiveProgramDocuments(versionDocument, draft),
    [versionDocument, draft],
  );

  const grouped = new Map<LiveProgramDiffArea, LiveProgramDiffEntry[]>();
  for (const entry of diff?.entries ?? []) {
    grouped.set(entry.area, [...(grouped.get(entry.area) ?? []), entry]);
  }

  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-border bg-surface p-3">
        <h2 className={sectionTitleClass}>下書きと版の差分</h2>
        <p className={metaTextClass}>
          版の内容を基準に、現在の下書きで追加・削除・変更された構造を表示します。差分は保存されません。
        </p>
        <label className="mt-2 block text-sm">
          比較する版
          <select
            className="mt-1 w-full rounded border border-border bg-surface px-2 py-1 text-sm"
            value={effectiveVersionId ?? ""}
            onChange={(event) => onSelectVersion(event.target.value || null)}
          >
            {versions.length === 0 && <option value="">版がありません</option>}
            {versions.map((entry) => (
              <option key={entry.id} value={entry.id}>
                v{entry.versionNumber}
                {entry.note === null ? "" : ` — ${entry.note}`}
              </option>
            ))}
          </select>
        </label>
        {versionsQuery.isError && (
          <p className="mt-2 text-sm text-red-600">{errorMessage(versionsQuery.error)}</p>
        )}
        {detailQuery.isError && (
          <p className="mt-2 text-sm text-red-600">{errorMessage(detailQuery.error)}</p>
        )}
        {version !== undefined && (
          <p className={`mt-1 ${metaTextClass}`}>
            v{version.versionNumber}（{new Date(version.createdAt).toLocaleString("ja-JP")}）との比較
          </p>
        )}
      </section>

      {diff === null ? (
        <p className={metaTextClass}>版を選択すると差分を表示します。</p>
      ) : diff.isEmpty ? (
        <p className={metaTextClass}>この版と現在の下書きに構造上の差分はありません。</p>
      ) : (
        <section className="rounded-lg border border-border bg-surface p-3">
          <div className="flex flex-wrap gap-2">
            <span className={badgeSuccessClass}>追加 {diff.counts.added}</span>
            <span className={badgeDangerClass}>削除 {diff.counts.removed}</span>
            <span className={badgeWarningClass}>変更 {diff.counts.changed}</span>
          </div>
          <div className="mt-3 space-y-3">
            {[...grouped.entries()].map(([area, entries]) => (
              <div key={area}>
                <h3 className="m-0 mb-1 text-sm font-semibold">{AREA_LABELS[area]}</h3>
                <ul className="m-0 list-none space-y-1 p-0">
                  {entries.map((entry, index) => (
                    <li
                      key={`${area}-${entry.id}-${entry.change}-${index}`}
                      className="flex flex-wrap items-center gap-2 text-sm"
                    >
                      <span className={changeBadge(entry.change)}>
                        {CHANGE_LABELS[entry.change]}
                      </span>
                      <span className="min-w-0 break-all font-mono text-xs text-muted-foreground">
                        {entry.id}
                      </span>
                      <span className="min-w-0 break-words">{entryLabel(entry)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className={`mt-3 ${metaTextClass}`}>
            カード状態は完全なスナップショットです。項目の増減も「項目」の変更として表示されます。
          </p>
        </section>
      )}
    </div>
  );
}
