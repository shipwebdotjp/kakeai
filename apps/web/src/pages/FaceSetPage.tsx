import { useEffect, useId, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { FaceSet } from "@kakeai/contracts";
import {
  useAssets,
  useCreateFaceSet,
  useDeleteFaceSet,
  useFaceSetUsages,
  useFaceSets,
  useUpdateFaceSet,
} from "../api/hooks";
import { randomId } from "../content/form";
import { errorMessage } from "../lib/errorMessage";
import {
  faceSetFoldKey,
  foldStorageKey,
  type FoldStorage,
} from "../lib/collapseState";
import { MediaPicker } from "../components/MediaPicker";
import {
  FaceSetUsagePreview,
  faceSetDimensionIssue,
} from "../components/face-set/FaceSetUsagePreview";
import { faceSetContentChanged } from "../components/face-set/faceSetDraft";
import {
  CollapsibleStateProvider,
  useStoredCollapsible,
} from "../components/Collapsible";
import {
  buttonDangerClass,
  buttonNeutralClass,
  buttonPrimaryClass,
  detailsSummaryClass,
  editAreaClass,
  errorTextClass,
  itemCardClass,
  metaTextClass,
  sectionCardClass,
  textFieldClass,
} from "../ui";

type LayerPart = "brow" | "eye" | "mouth" | "foreground";

const PART_LABELS: Record<LayerPart, string> = {
  brow: "眉",
  eye: "目",
  mouth: "口",
  foreground: "前景",
};

const PARTS: LayerPart[] = ["brow", "eye", "mouth", "foreground"];

interface LayerDraft {
  id: string;
  part: LayerPart;
  assetId: string | null;
  blinkLayerId: string | null;
  speakingLayerId: string | null;
}

interface PresetDraft {
  id: string;
  name: string;
  browLayerId: string | null;
  eyeLayerId: string | null;
  mouthLayerId: string | null;
}

interface FaceSetDraft {
  name: string;
  layers: LayerDraft[];
  expressions: PresetDraft[];
}

function toDraft(entry: FaceSet): FaceSetDraft {
  return {
    name: entry.name,
    layers: entry.layers.map((layer) => ({
      id: layer.id,
      part: layer.part,
      assetId: layer.assetId,
      blinkLayerId: layer.blinkLayerId,
      speakingLayerId: layer.speakingLayerId,
    })),
    expressions: entry.expressions.map((preset) => ({
      id: preset.id,
      name: preset.name,
      browLayerId: preset.browLayerId,
      eyeLayerId: preset.eyeLayerId,
      mouthLayerId: preset.mouthLayerId,
    })),
  };
}

function emptyDraft(): FaceSetDraft {
  return {
    name: "",
    layers: [],
    expressions: [
      {
        id: "normal",
        name: "通常",
        browLayerId: null,
        eyeLayerId: null,
        mouthLayerId: null,
      },
    ],
  };
}

function emptyLayer(part: LayerPart = "brow"): LayerDraft {
  return {
    id: `layer-${randomId()}`,
    part,
    assetId: null,
    blinkLayerId: null,
    speakingLayerId: null,
  };
}

function emptyPreset(): PresetDraft {
  return {
    id: `expression-${randomId()}`,
    name: "",
    browLayerId: null,
    eyeLayerId: null,
    mouthLayerId: null,
  };
}

function LayerSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | null;
  options: { id: string; label: string }[];
  onChange: (value: string | null) => void;
}) {
  return (
    <label className="inline-flex items-center gap-1.5">
      {label}
      <select
        className={textFieldClass}
        value={value ?? ""}
        onChange={(event) =>
          onChange(event.target.value === "" ? null : event.target.value)
        }
      >
        <option value="">なし</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function FaceSetForm({ entry }: { entry?: FaceSet }) {
  const create = useCreateFaceSet();
  const update = useUpdateFaceSet();
  const remove = useDeleteFaceSet();
  const assets = useAssets();
  const usages = useFaceSetUsages(entry?.id);
  const [draft, setDraft] = useState<FaceSetDraft>(
    entry === undefined ? emptyDraft() : toDraft(entry),
  );
  const [issue, setIssue] = useState<string | null>(null);
  // "faceset-new-form" は isPersistedFoldKey の対象外のため、開閉状態は永続化されずセッション内のみ有効（再訪時は常に開いた状態）。
  const [open, setOpen] = useStoredCollapsible(
    entry === undefined ? "faceset-new-form" : faceSetFoldKey(entry.id),
    entry === undefined,
  );
  const bodyId = useId();
  const headerSummary = `レイヤー${draft.layers.length}件・表情${draft.expressions.length}件`;
  const hasContentChanges =
    entry !== undefined && faceSetContentChanged(entry, draft);

  useEffect(() => {
    if (entry !== undefined) {
      setDraft(toDraft(entry));
    }
  }, [entry?.id, entry?.updatedAt]);

  const mutation = entry === undefined ? create : update;
  const byId = new Map(assets.data?.map((asset) => [asset.id, asset]) ?? []);

  const patchLayer = (id: string, patch: Partial<LayerDraft>) => {
    setDraft((current) => ({
      ...current,
      layers: current.layers.map((layer) =>
        layer.id === id ? { ...layer, ...patch } : layer,
      ),
    }));
  };

  const patchPreset = (id: string, patch: Partial<PresetDraft>) => {
    setDraft((current) => ({
      ...current,
      expressions: current.expressions.map((preset) =>
        preset.id === id ? { ...preset, ...patch } : preset,
      ),
    }));
  };

  const save = () => {
    // 保存ボタンは折りたたみ時も表示されるため、検証エラーの対象が見えるよう本文を開く。
    setOpen(true);
    if (entry !== undefined && usages.isLoading) {
      setIssue(
        "使用中キャラクターのベース画像との寸法を確認中です。読み込み完了後に保存してください。",
      );
      return;
    }
    if (entry !== undefined && usages.isError) {
      setIssue(
        "使用中キャラクターの情報を読み込めないため、寸法を確認できません。再読み込みしてから保存してください。",
      );
      return;
    }
    const name = draft.name.trim();
    if (name.length === 0) {
      setIssue("名前を入力してください。");
      return;
    }
    const missingAsset = draft.layers.findIndex(
      (layer) => layer.assetId === null || layer.assetId.length === 0,
    );
    if (missingAsset !== -1) {
      setIssue(`レイヤー ${missingAsset + 1} の画像を選んでください。`);
      return;
    }
    if (!draft.expressions.some((preset) => preset.id === "normal")) {
      setIssue("normal の表情が必要です。");
      return;
    }
    const dims = draft.layers.map((layer) => {
      const asset =
        layer.assetId === null ? undefined : byId.get(layer.assetId);
      return asset === undefined
        ? null
        : { widthPx: asset.widthPx, heightPx: asset.heightPx };
    });
    if (assets.isLoading) {
      setIssue("素材情報を読み込み中です。しばらく待って保存してください。");
      return;
    }
    if (!assets.isError) {
      if (
        dims.some(
          (size) =>
            size === null || size.widthPx === null || size.heightPx === null,
        )
      ) {
        setIssue("レイヤーの寸法を確認できません。画像を選び直してください。");
        return;
      }
      const first = dims[0];
      if (
        first !== null &&
        dims.some(
          (size): size is { widthPx: number; heightPx: number } =>
            size !== null &&
            (size.widthPx !== first.widthPx ||
              size.heightPx !== first.heightPx),
        )
      ) {
        setIssue("顔レイヤーは同じ寸法の画像にしてください。");
        return;
      }
      for (const usage of usages.data?.libraryAppearances ?? []) {
        const problem = faceSetDimensionIssue(usage, draft.layers, byId);
        if (problem !== null) {
          setIssue(`${usage.characterName}: ${problem}`);
          return;
        }
      }
    }
    setIssue(null);
    const payload = {
      name,
      layers: draft.layers.map((layer) => ({
        id: layer.id,
        part: layer.part,
        assetId: layer.assetId ?? "",
        blinkLayerId: layer.blinkLayerId,
        speakingLayerId: layer.speakingLayerId,
      })),
      expressions: draft.expressions.map((preset) => ({
        id: preset.id,
        name: preset.name,
        browLayerId: preset.browLayerId,
        eyeLayerId: preset.eyeLayerId,
        mouthLayerId: preset.mouthLayerId,
      })),
    };
    if (entry === undefined) {
      create.mutate(payload, { onSuccess: () => setDraft(emptyDraft()) });
    } else {
      update.mutate({ id: entry.id, input: payload });
    }
  };

  const layerIndexById = new Map(
    draft.layers.map((layer, index) => [layer.id, index]),
  );
  const layerById = new Map(draft.layers.map((layer) => [layer.id, layer]));
  const describeLayer = (id: string): string => {
    const index = layerIndexById.get(id);
    const layer = layerById.get(id);
    if (index === undefined || layer === undefined) {
      return `不明なレイヤー (${id})`;
    }
    const assetName =
      layer.assetId === null
        ? "画像未指定"
        : (byId.get(layer.assetId)?.originalFilename ?? "素材不明");
    return `レイヤー ${index + 1} ${assetName}`;
  };
  const variantOptions = (part: LayerPart, excludeId: string) =>
    draft.layers
      .filter((layer) => layer.part === part && layer.id !== excludeId)
      .map((layer) => ({ id: layer.id, label: describeLayer(layer.id) }));
  const layerOptions = (part: LayerPart) =>
    draft.layers
      .filter((layer) => layer.part === part)
      .map((layer) => ({ id: layer.id, label: describeLayer(layer.id) }));
  const blinkTargets = new Set(
    draft.layers.flatMap((layer) =>
      layer.blinkLayerId === null ? [] : [layer.blinkLayerId],
    ),
  );
  const speakingTargets = new Set(
    draft.layers.flatMap((layer) =>
      layer.speakingLayerId === null ? [] : [layer.speakingLayerId],
    ),
  );
  const presetNamesUsing = (layerId: string): string[] =>
    draft.expressions
      .filter(
        (preset) =>
          preset.browLayerId === layerId ||
          preset.eyeLayerId === layerId ||
          preset.mouthLayerId === layerId,
      )
      .map((preset) =>
        preset.name.trim().length > 0 ? preset.name : preset.id,
      );

  const addVariantLayer = (
    baseId: string,
    part: LayerPart,
    key: "blinkLayerId" | "speakingLayerId",
  ) => {
    const variant = emptyLayer(part);
    setDraft((current) => {
      const base = current.layers.find((layer) => layer.id === baseId);
      if (base === undefined || base[key] !== null) {
        return current;
      }
      return {
        ...current,
        layers: [
          ...current.layers.map((layer) =>
            layer.id === baseId ? { ...layer, [key]: variant.id } : layer,
          ),
          variant,
        ],
      };
    });
  };

  return (
    <section className={sectionCardClass}>
      <div className="mt-0 mb-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={`表情セット「${draft.name.trim().length > 0 ? draft.name : (entry?.name ?? "新規")}」（${headerSummary}）を${open ? "閉じる" : "開く"}`}
          onClick={() => setOpen(!open)}
          className={detailsSummaryClass}
        >
          <ChevronDown
            aria-hidden="true"
            className={`h-4 w-4 shrink-0 transition-transform ${open ? "" : "-rotate-90"}`}
          />
          <span className="font-normal text-muted-foreground">
            {headerSummary}
          </span>
        </button>
        <input
          aria-label="表情セット名"
          value={draft.name}
          placeholder="表情セット名（例: リン正面）"
          className={`min-w-[200px] flex-1 font-semibold ${textFieldClass}`}
          onChange={(event) =>
            setDraft((current) => ({ ...current, name: event.target.value }))
          }
        />
        {entry !== undefined && (
          <button
            type="button"
            className={buttonDangerClass}
            disabled={remove.isPending}
            onClick={() => {
              if (
                window.confirm(`「${entry.name || entry.id}」を削除しますか？`)
              ) {
                remove.mutate(entry.id);
              }
            }}
          >
            削除
          </button>
        )}
      </div>

      <div id={bodyId} hidden={!open}>
        {entry !== undefined && (
          <FaceSetUsagePreview
            usages={usages.data?.libraryAppearances}
            usagesLoading={usages.isLoading}
            usagesError={usages.isError}
            layers={draft.layers}
            expressions={draft.expressions}
            assetsById={byId}
          />
        )}
        <div className={editAreaClass}>
          <p className="mb-1 text-sm font-medium">
            顔レイヤー（立ち絵と同じ寸法の透過画像）
          </p>
          <p className={metaTextClass}>
            閉眼・開口の画像も目・口レイヤーとして追加し、ふだん出す側の「閉眼」「開口」で相手先を指定します。閉眼・開口用は表情プリセットでは選ばず、開眼・閉口側に紐付けます。
          </p>
          {draft.layers.map((layer, index) => (
            <div key={layer.id} className={itemCardClass}>
              <MediaPicker
                label={`レイヤー ${index + 1} の画像`}
                kinds={["image"]}
                selectedAssetId={layer.assetId}
                onSelect={(assetId) => patchLayer(layer.id, { assetId })}
              />
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-1.5">
                  部位
                  <select
                    className={textFieldClass}
                    value={layer.part}
                    onChange={(event) =>
                      patchLayer(layer.id, {
                        part: event.target.value as LayerPart,
                        blinkLayerId: null,
                        speakingLayerId: null,
                      })
                    }
                  >
                    {PARTS.map((part) => (
                      <option key={part} value={part}>
                        {PART_LABELS[part]}
                      </option>
                    ))}
                  </select>
                </label>
                {layer.part === "eye" && (
                  <>
                    <LayerSelect
                      label="閉眼"
                      value={layer.blinkLayerId}
                      options={variantOptions("eye", layer.id)}
                      onChange={(blinkLayerId) =>
                        patchLayer(layer.id, { blinkLayerId })
                      }
                    />
                    <button
                      type="button"
                      className={buttonNeutralClass}
                      disabled={layer.blinkLayerId !== null}
                      onClick={() =>
                        addVariantLayer(layer.id, "eye", "blinkLayerId")
                      }
                    >
                      閉眼用を追加して割当
                    </button>
                  </>
                )}
                {layer.part === "mouth" && (
                  <>
                    <LayerSelect
                      label="開口"
                      value={layer.speakingLayerId}
                      options={variantOptions("mouth", layer.id)}
                      onChange={(speakingLayerId) =>
                        patchLayer(layer.id, { speakingLayerId })
                      }
                    />
                    <button
                      type="button"
                      className={buttonNeutralClass}
                      disabled={layer.speakingLayerId !== null}
                      onClick={() =>
                        addVariantLayer(layer.id, "mouth", "speakingLayerId")
                      }
                    >
                      開口用を追加して割当
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className={buttonDangerClass}
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      layers: current.layers
                        .filter((candidate) => candidate.id !== layer.id)
                        .map((candidate) => ({
                          ...candidate,
                          blinkLayerId:
                            candidate.blinkLayerId === layer.id
                              ? null
                              : candidate.blinkLayerId,
                          speakingLayerId:
                            candidate.speakingLayerId === layer.id
                              ? null
                              : candidate.speakingLayerId,
                        })),
                      expressions: current.expressions.map((preset) => ({
                        ...preset,
                        browLayerId:
                          preset.browLayerId === layer.id
                            ? null
                            : preset.browLayerId,
                        eyeLayerId:
                          preset.eyeLayerId === layer.id
                            ? null
                            : preset.eyeLayerId,
                        mouthLayerId:
                          preset.mouthLayerId === layer.id
                            ? null
                            : preset.mouthLayerId,
                      })),
                    }))
                  }
                >
                  レイヤーを削除
                </button>
              </div>
              <p className={metaTextClass}>
                {[
                  blinkTargets.has(layer.id) ? "閉眼用として使用中" : null,
                  speakingTargets.has(layer.id) ? "開口用として使用中" : null,
                  layer.blinkLayerId !== null
                    ? `瞬き先: ${describeLayer(layer.blinkLayerId)}`
                    : null,
                  layer.speakingLayerId !== null
                    ? `口パク先: ${describeLayer(layer.speakingLayerId)}`
                    : null,
                  (() => {
                    const names = presetNamesUsing(layer.id);
                    return names.length > 0
                      ? `表情で使用: ${names.join("、")}`
                      : "表情では未使用";
                  })(),
                ]
                  .filter((text) => text !== null)
                  .join(" / ")}
              </p>
            </div>
          ))}
          <button
            type="button"
            className={buttonNeutralClass}
            onClick={() =>
              setDraft((current) => ({
                ...current,
                layers: [...current.layers, emptyLayer()],
              }))
            }
          >
            レイヤーを追加
          </button>
        </div>

        <div className={editAreaClass}>
          <p className="mb-1 text-sm font-medium">
            表情プリセット（normal は必須）
          </p>
          {draft.expressions.map((preset) => (
            <div key={preset.id} className={itemCardClass}>
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-1.5">
                  表示名
                  <input
                    value={preset.name}
                    placeholder="例: 笑い"
                    className={textFieldClass}
                    onChange={(event) =>
                      patchPreset(preset.id, { name: event.target.value })
                    }
                  />
                </label>
                <span className={metaTextClass}>{preset.id}</span>
                {preset.id !== "normal" && (
                  <button
                    type="button"
                    className={buttonDangerClass}
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        expressions: current.expressions.filter(
                          (candidate) => candidate.id !== preset.id,
                        ),
                      }))
                    }
                  >
                    表情を削除
                  </button>
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <LayerSelect
                  label="眉"
                  value={preset.browLayerId}
                  options={layerOptions("brow")}
                  onChange={(browLayerId) =>
                    patchPreset(preset.id, { browLayerId })
                  }
                />
                <LayerSelect
                  label="目"
                  value={preset.eyeLayerId}
                  options={layerOptions("eye")}
                  onChange={(eyeLayerId) =>
                    patchPreset(preset.id, { eyeLayerId })
                  }
                />
                <LayerSelect
                  label="口"
                  value={preset.mouthLayerId}
                  options={layerOptions("mouth")}
                  onChange={(mouthLayerId) =>
                    patchPreset(preset.id, { mouthLayerId })
                  }
                />
              </div>
              {(preset.eyeLayerId !== null &&
                blinkTargets.has(preset.eyeLayerId)) ||
              (preset.mouthLayerId !== null &&
                speakingTargets.has(preset.mouthLayerId)) ? (
                <p className={errorTextClass}>
                  閉眼・開口用として使うレイヤーを選んでいます。ふだん出す開眼・閉口側を選び直してください。閉眼・開口用は上の顔レイヤーの「閉眼」「開口」で紐付けます。
                </p>
              ) : null}
            </div>
          ))}
          <button
            type="button"
            className={buttonNeutralClass}
            onClick={() =>
              setDraft((current) => ({
                ...current,
                expressions: [...current.expressions, emptyPreset()],
              }))
            }
          >
            表情を追加
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={buttonPrimaryClass}
          disabled={mutation.isPending}
          onClick={save}
        >
          {entry === undefined
            ? "追加"
            : hasContentChanges
              ? "新しい改訂版として保存"
              : "名前を保存"}
        </button>
        {entry !== undefined && (
          <span className={metaTextClass}>
            {entry.id} / v{entry.version}
          </span>
        )}
      </div>
      {entry !== undefined && (
        <p className={metaTextClass}>
          レイヤー・表情の変更は新しい改訂版として保存され、作品は固定した版を使い続けます。名前だけの変更では版は増えません。
        </p>
      )}
      {issue !== null && <p className={errorTextClass}>{issue}</p>}
      {mutation.isError && (
        <p className={errorTextClass}>{errorMessage(mutation.error)}</p>
      )}
      {remove.isError && (
        <p className={errorTextClass}>{errorMessage(remove.error)}</p>
      )}
    </section>
  );
}

function getFoldStorage(): FoldStorage | null {
  try {
    if (typeof window === "undefined") {
      return null;
    }
    return window.localStorage;
  } catch {
    return null;
  }
}

export function FaceSetPage() {
  const persistence = useMemo(
    () => ({
      storage: getFoldStorage(),
      storageKey: foldStorageKey("face-sets"),
    }),
    [],
  );

  return (
    <CollapsibleStateProvider resetKey="face-sets" persistence={persistence}>
      <FaceSetPageContent />
    </CollapsibleStateProvider>
  );
}

function FaceSetPageContent() {
  const faceSets = useFaceSets();

  return (
    <section>
      <h1 className="my-3 text-2xl font-bold">表情セット</h1>
      <p className={metaTextClass}>
        互換な外観で共有する顔素材を登録します。ベース立ち絵と同じ寸法の透過画像を眉・目・口・前景に分け、表情ごとに組み合わせます。外観に割り当てると、台詞ごとに表情を切り替えられます。
      </p>

      {faceSets.isLoading && <p>読み込み中…</p>}
      {faceSets.isError && (
        <p className={errorTextClass}>{errorMessage(faceSets.error)}</p>
      )}
      {faceSets.data !== undefined && faceSets.data.length === 0 && (
        <p className={metaTextClass}>
          表情セットがありません。下のフォームから追加してください。
        </p>
      )}

      {faceSets.data?.map((entry) => (
        <FaceSetForm key={entry.id} entry={entry} />
      ))}

      <FaceSetForm />
    </section>
  );
}
