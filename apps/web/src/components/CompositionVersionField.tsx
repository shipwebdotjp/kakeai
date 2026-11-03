import { useContext, useMemo, useState } from "react";
import {
  compositionSkinRelation,
  type CanvasProfile,
  type CompositionStyleProvenance,
  type VisualSkinRef,
} from "@kakeai/contracts";
import { compositionVersionOptions } from "../content/form";
import { useCompositions } from "../api/hooks";
import { errorTextClass, formLabelClass, metaTextClass, textFieldClass } from "../ui";
import { ScriptSkinContext, WorkIdContext } from "./composition-context";

interface CompositionVersionFieldProps {
  label: string;
  value: string;
  setField: (key: string, value: string) => void;
  fieldKey: string;
  profiles?: readonly CanvasProfile[];
}

function skinMismatchMessage(
  relation: ReturnType<typeof compositionSkinRelation>,
  scriptSkin: VisualSkinRef,
  provenance: CompositionStyleProvenance | undefined,
): string | undefined {
  const scriptLabel = `${scriptSkin.id}@${scriptSkin.version}`;
  if (relation === "neutral") {
    return `このCompositionはスキン未指定（neutral）で作られています。台本のスキン ${scriptLabel} と調和しない可能性があります。`;
  }
  if (relation === "legacy") {
    return `このCompositionの作風情報がありません（legacy）。台本のスキン ${scriptLabel} と調和しない可能性があります。`;
  }
  if (relation === "different" && provenance?.kind === "authored") {
    return `このCompositionは ${provenance.skin.id}@${provenance.skin.version} で作られています。台本のスキン ${scriptLabel} と異なります。`;
  }
  return undefined;
}

export function CompositionVersionField({
  label,
  value,
  setField,
  fieldKey,
  profiles,
}: CompositionVersionFieldProps) {
  const workId = useContext(WorkIdContext);
  const compositions = useCompositions(
    workId === null
      ? { archived: "include" }
      : { workId, archived: "include" },
  );
  const scriptSkin = useContext(ScriptSkinContext);
  const [showAllVersions, setShowAllVersions] = useState(false);
  const [search, setSearch] = useState("");

  const allOptions = useMemo(
    () => compositionVersionOptions(compositions.data ?? [], profiles, "all"),
    [compositions.data, profiles],
  );
  const visibleOptions = useMemo(() => {
    const usable = (compositions.data ?? []).filter(
      (composition) =>
        composition.archivedAt === null ||
        (composition.versions ?? []).some((version) => version.id === value),
    );
    const archivedCompositionIds = new Set(
      usable
        .filter((composition) => composition.archivedAt !== null)
        .map((composition) => composition.id),
    );
    const options = compositionVersionOptions(
      usable,
      profiles,
      showAllVersions ? "all" : "latest",
    ).filter(
      (option) =>
        !archivedCompositionIds.has(option.compositionId) ||
        option.value === value,
    );
    const scopeOrder: Record<string, number> = {
      work: 0,
      shared: 1,
      unclassified: 2,
    };
    return [...options].sort((left, right) => {
      const scopeDifference =
        (scopeOrder[left.scope] ?? 3) - (scopeOrder[right.scope] ?? 3);
      if (scopeDifference !== 0) {
        return scopeDifference;
      }
      const nameDifference = left.compositionName.localeCompare(
        right.compositionName,
        "ja",
      );
      if (nameDifference !== 0) {
        return nameDifference;
      }
      return left.versionNumber - right.versionNumber;
    });
  }, [compositions.data, profiles, showAllVersions, value]);

  const normalizedSearch = search.trim().toLocaleLowerCase("ja");
  const filteredOptions =
    normalizedSearch.length === 0
      ? visibleOptions
      : visibleOptions.filter(
          (option) =>
            option.compositionName
              .toLocaleLowerCase("ja")
              .includes(normalizedSearch) ||
            option.runtimeCompositionId
              .toLocaleLowerCase("ja")
              .includes(normalizedSearch),
        );
  const currentOption = allOptions.find((option) => option.value === value);
  const currentInFiltered = filteredOptions.some(
    (option) => option.value === value,
  );
  const currentLabel =
    currentOption === undefined
      ? `${value}（候補外または不明）`
      : `${currentOption.label}（使用中）`;

  const provenanceByVersionId = useMemo(() => {
    const map = new Map<string, CompositionStyleProvenance | undefined>();
    for (const composition of compositions.data ?? []) {
      for (const version of composition.versions ?? []) {
        map.set(version.id, version.styleProvenance);
      }
    }
    return map;
  }, [compositions.data]);
  const provenance = provenanceByVersionId.get(value);
  const knownInLibrary = provenanceByVersionId.has(value);
  const mismatch =
    scriptSkin !== null && value.length > 0 && knownInLibrary
      ? skinMismatchMessage(
          compositionSkinRelation(scriptSkin, provenance),
          scriptSkin,
          provenance,
        )
      : undefined;

  return (
    <div className="my-2">
      <span className={`${formLabelClass} font-medium`}>{label}</span>
      <input
        type="search"
        className={`${textFieldClass} mt-1`}
        value={search}
        placeholder="Composition名・runtime IDで検索"
        aria-label={`${label}を検索`}
        onChange={(event) => setSearch(event.target.value)}
      />
      <select
        className={`${textFieldClass} mt-1`}
        value={value}
        aria-label={label}
        onChange={(event) => setField(fieldKey, event.target.value)}
      >
        <option value="">未指定</option>
        {value.length > 0 && !currentInFiltered && (
          <option value={value}>{currentLabel}</option>
        )}
        {filteredOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <label className="mt-1 flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={showAllVersions}
          onChange={(event) => setShowAllVersions(event.target.checked)}
        />
        すべてのバージョンを表示
      </label>
      {compositions.isLoading && (
        <p className={metaTextClass}>公開バージョンを読み込み中…</p>
      )}
      {compositions.isError && (
        <p className={errorTextClass}>公開バージョンを取得できませんでした。</p>
      )}
      {!compositions.isLoading &&
        compositions.data !== undefined &&
        filteredOptions.length === 0 && (
          <p className={metaTextClass}>
            {normalizedSearch.length > 0
              ? "検索条件に一致するCompositionがありません。"
              : "この作品で使える公開済みCompositionVersionがありません。"}
          </p>
        )}
      {mismatch !== undefined && (
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{mismatch}</p>
      )}
    </div>
  );
}
