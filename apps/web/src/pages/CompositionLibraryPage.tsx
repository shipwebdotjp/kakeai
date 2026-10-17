import { useState } from "react";
import type { Composition, CompositionStyleProvenance } from "@kakeai/contracts";
import { CANVAS_PROFILE_LABELS, canvasProfileOf } from "@kakeai/contracts";
import { useCompositions } from "../api/hooks";
import { errorMessage } from "../lib/errorMessage";
import { buttonNeutralClass, errorTextClass, metaTextClass } from "../ui";

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

export function CompositionLibraryPage() {
  const compositions = useCompositions();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const entries = compositions.data ?? [];
  const selected = entries.find((entry) => entry.id === selectedId) ?? null;
  const versions = selected?.versions ?? [];

  return (
    <section>
      <h1 className="my-3 text-2xl font-bold">Composition Library</h1>
      <p className={metaTextClass}>
        AIが作成・公開した全画面モーションの一覧です。台本のScene背景には公開バージョンのIDを指定します。編集・公開はAIが行います。
      </p>

      {compositions.isLoading && <p>読み込み中…</p>}
      {compositions.isError && (
        <p className={errorTextClass}>{errorMessage(compositions.error)}</p>
      )}
      {compositions.data !== undefined && entries.length === 0 && (
        <p className={metaTextClass}>Compositionがありません。</p>
      )}

      <ul className="mt-4 space-y-2">
        {entries.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              onClick={() => setSelectedId(entry.id === selectedId ? null : entry.id)}
              className={`${buttonNeutralClass} w-full text-left`}
              aria-pressed={entry.id === selectedId}
            >
              <span className="block font-bold">{entry.name}</span>
              <span className={metaTextClass}>
                {entry.runtimeCompositionId} / {draftStatus(entry)} / 公開
                {entry.versions?.length ?? 0}
                件
              </span>
            </button>
          </li>
        ))}
      </ul>

      {selected !== null && (
        <section className="mt-6" aria-label="選択中のComposition">
          <h2 className="text-xl font-bold">{selected.name}</h2>
          <p className={metaTextClass}>runtime: {selected.runtimeCompositionId}</p>
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
