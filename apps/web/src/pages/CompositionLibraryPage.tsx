import { useMemo, useState } from "react";
import type { Composition, CompositionScope, CompositionStyleProvenance } from "@kakeai/contracts";
import { CANVAS_PROFILE_LABELS, canvasProfileOf } from "@kakeai/contracts";
import {
  useCompositions,
  useUpdateCompositionArchive,
  useWorks,
} from "../api/hooks";
import { errorMessage } from "../lib/errorMessage";
import { buttonNeutralClass, errorTextClass, metaTextClass, textFieldClass } from "../ui";

function shortHash(hash: string): string {
  return hash.length > 12 ? `${hash.slice(0, 12)}…` : hash;
}

function draftStatus(composition: Composition): string {
  if (composition.draft === null || composition.draft === undefined) {
    return "draftなし";
  }
  return `draft: ${composition.draft.entrypoint}`;
}

function provenanceLabel(provenance: CompositionStyleProvenance | undefined): string {
  if (provenance === undefined || provenance.kind === "legacy") {
    return "legacy（作風情報なし）";
  }
  if (provenance.kind === "neutral") {
    return "neutral（スキン未指定）";
  }
  return `${provenance.skin.id}@${provenance.skin.version}`;
}

function scopeLabel(scope: CompositionScope, workTitle: string | undefined): string {
  if (scope === "shared") {
    return "全作品共通";
  }
  if (scope === "unclassified") {
    return "未分類";
  }
  return workTitle === undefined ? "作品専用" : `作品専用: ${workTitle}`;
}

type ScopeFilter = "all" | CompositionScope;
type ArchiveFilter = "exclude" | "include" | "only";

export function CompositionLibraryPage() {
  const compositions = useCompositions({ archived: "include" });
  const works = useWorks();
  const archive = useUpdateCompositionArchive();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [workFilter, setWorkFilter] = useState("all");
  const [archiveFilter, setArchiveFilter] = useState<ArchiveFilter>("exclude");
  const [query, setQuery] = useState("");

  const worksById = useMemo(() => {
    const map = new Map<string, string>();
    for (const work of works.data ?? []) {
      map.set(work.id, work.title);
    }
    return map;
  }, [works.data]);

  const entries = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ja");
    return (compositions.data ?? []).filter((composition) => {
      if (archiveFilter === "exclude" && composition.archivedAt !== null) {
        return false;
      }
      if (archiveFilter === "only" && composition.archivedAt === null) {
        return false;
      }
      if (scopeFilter !== "all" && composition.scope !== scopeFilter) {
        return false;
      }
      if (workFilter !== "all" && composition.workId !== workFilter) {
        return false;
      }
      if (normalized.length === 0) {
        return true;
      }
      return (
        composition.name.toLocaleLowerCase("ja").includes(normalized) ||
        composition.runtimeCompositionId.toLocaleLowerCase("ja").includes(normalized)
      );
    });
  }, [archiveFilter, compositions.data, query, scopeFilter, workFilter]);

  const selected =
    (compositions.data ?? []).find((entry) => entry.id === selectedId) ?? null;
  const versions = selected?.versions ?? [];

  return (
    <section>
      <h1 className="my-3 text-2xl font-bold">Composition Library</h1>
      <p className={metaTextClass}>
        AIが作成・公開した全画面モーションの一覧です。Compositionは作品専用か全作品共通のどちらかに所属し、台本のScene背景にはその作品で使える公開バージョンのIDを指定します。編集・公開はAIが行います。
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className={`${metaTextClass} flex flex-col`}>
          検索
          <input
            type="search"
            className={textFieldClass}
            value={query}
            placeholder="名前・runtime ID"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label className={`${metaTextClass} flex flex-col`}>
          所属
          <select
            className={textFieldClass}
            value={scopeFilter}
            onChange={(event) => setScopeFilter(event.target.value as ScopeFilter)}
          >
            <option value="all">すべて</option>
            <option value="work">作品専用</option>
            <option value="shared">全作品共通</option>
            <option value="unclassified">未分類</option>
          </select>
        </label>
        <label className={`${metaTextClass} flex flex-col`}>
          作品
          <select
            className={textFieldClass}
            value={workFilter}
            onChange={(event) => setWorkFilter(event.target.value)}
          >
            <option value="all">すべて</option>
            {(works.data ?? []).map((work) => (
              <option key={work.id} value={work.id}>
                {work.title}
              </option>
            ))}
          </select>
        </label>
        <label className={`${metaTextClass} flex flex-col`}>
          アーカイブ
          <select
            className={textFieldClass}
            value={archiveFilter}
            onChange={(event) => setArchiveFilter(event.target.value as ArchiveFilter)}
          >
            <option value="exclude">表示しない</option>
            <option value="include">含める</option>
            <option value="only">アーカイブ済みのみ</option>
          </select>
        </label>
      </div>

      {compositions.isLoading && <p>読み込み中…</p>}
      {compositions.isError && (
        <p className={errorTextClass}>{errorMessage(compositions.error)}</p>
      )}
      {works.isLoading && <p className={metaTextClass}>作品一覧を読み込み中…</p>}
      {works.isError && <p className={errorTextClass}>{errorMessage(works.error)}</p>}
      {archive.isError && <p className={errorTextClass}>{errorMessage(archive.error)}</p>}
      {compositions.data !== undefined && entries.length === 0 && (
        <p className={metaTextClass}>条件に一致するCompositionがありません。</p>
      )}

      <ul className="mt-4 space-y-2">
        {entries.map((entry) => (
          <li key={entry.id} className="flex items-start gap-2">
            <button
              type="button"
              onClick={() => setSelectedId(entry.id === selectedId ? null : entry.id)}
              className={`${buttonNeutralClass} flex-1 text-left`}
              aria-pressed={entry.id === selectedId}
            >
              <span className="block font-bold">
                {entry.name}
                <span className="ml-2 text-xs font-normal">
                  [{scopeLabel(entry.scope, entry.workId === null ? undefined : worksById.get(entry.workId))}]
                </span>
                {entry.archivedAt !== null && (
                  <span className="ml-2 text-xs font-normal">アーカイブ済み</span>
                )}
              </span>
              <span className={metaTextClass}>
                {entry.runtimeCompositionId} / {draftStatus(entry)} / 公開
                {entry.versions?.length ?? 0}
                件
              </span>
            </button>
            <button
              type="button"
              className={`${buttonNeutralClass} shrink-0`}
              disabled={archive.isPending}
              onClick={() =>
                archive.mutate({
                  compositionId: entry.id,
                  archived: entry.archivedAt === null,
                })
              }
            >
              {entry.archivedAt === null ? "アーカイブ" : "解除"}
            </button>
          </li>
        ))}
      </ul>

      {selected !== null && (
        <section className="mt-6" aria-label="選択中のComposition">
          <h2 className="text-xl font-bold">{selected.name}</h2>
          <p className={metaTextClass}>runtime: {selected.runtimeCompositionId}</p>
          <p className={metaTextClass}>
            所属: {scopeLabel(selected.scope, selected.workId === null ? undefined : worksById.get(selected.workId))}
            {selected.archivedAt === null ? "" : " / アーカイブ済み"}
          </p>
          <p className={metaTextClass}>
            {selected.draft === null || selected.draft === undefined
              ? "draftはありません。"
              : `draft entrypoint: ${selected.draft.entrypoint}（更新: ${selected.draft.updatedAt}）`}
          </p>
          <h3 className="mt-4 font-bold">公開バージョン</h3>
          {versions.length === 0 && <p className={metaTextClass}>公開バージョンがありません。</p>}
          {versions.length > 0 && (
            <table className="mt-2 w-full text-left text-sm">
              <thead>
                <tr>
                  <th className="pr-4">版</th>
                  <th className="pr-4">キャンバス</th>
                  <th className="pr-4">スキン</th>
                  <th className="pr-4">バージョンID</th>
                  <th className="pr-4">bundle</th>
                  <th className="pr-4">entrypoint</th>
                  <th>公開日時</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((version) => (
                  <tr key={version.id} className="border-t border-border">
                    <td className="py-1 pr-4">v{version.versionNumber}</td>
                    <td className="py-1 pr-4">
                      {CANVAS_PROFILE_LABELS[canvasProfileOf(version.manifest)]}
                    </td>
                    <td className="py-1 pr-4">{provenanceLabel(version.styleProvenance)}</td>
                    <td className="py-1 pr-4 font-mono text-xs">{version.id}</td>
                    <td className="py-1 pr-4 font-mono text-xs" title={version.bundleHash}>
                      {shortHash(version.bundleHash)}
                    </td>
                    <td className="py-1 pr-4">{version.manifest.entrypoint}</td>
                    <td className="py-1">{version.createdAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </section>
  );
}
