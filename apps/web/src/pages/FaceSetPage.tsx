import { useEffect, useState } from "react";
import type { FaceSet } from "@kakeai/contracts";
import {
  useAssets,
  useCreateFaceSet,
  useDeleteFaceSet,
  useFaceSets,
  useUpdateFaceSet,
} from "../api/hooks";
import { randomId } from "../content/form";
import { errorMessage } from "../lib/errorMessage";
import { MediaPicker } from "../components/MediaPicker";
import {
  buttonDangerClass,
  buttonNeutralClass,
  buttonPrimaryClass,
  errorTextClass,
  metaTextClass,
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
    expressions: [{ id: "normal", name: "通常", browLayerId: null, eyeLayerId: null, mouthLayerId: null }],
  };
}

function emptyLayer(): LayerDraft {
  return {
    id: `layer-${randomId()}`,
    part: "brow",
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
  const [draft, setDraft] = useState<FaceSetDraft>(entry === undefined ? emptyDraft() : toDraft(entry));
  const [issue, setIssue] = useState<string | null>(null);

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
      layers: current.layers.map((layer) => (layer.id === id ? { ...layer, ...patch } : layer)),
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
      const asset = layer.assetId === null ? undefined : byId.get(layer.assetId);
      return asset === undefined ? null : { widthPx: asset.widthPx, heightPx: asset.heightPx };
    });
    if (assets.isLoading) {
      setIssue("素材情報を読み込み中です。しばらく待って保存してください。");
      return;
    }
    if (!assets.isError) {
      if (dims.some((size) => size === null || size.widthPx === null || size.heightPx === null)) {
        setIssue("レイヤーの寸法を確認できません。画像を選び直してください。");
        return;
      }
      const first = dims[0];
      if (
        first !== null &&
        dims.some(
          (size): size is { widthPx: number; heightPx: number } =>
            size !== null && (size.widthPx !== first.widthPx || size.heightPx !== first.heightPx),
        )
      ) {
        setIssue("顔レイヤーは同じ寸法の画像にしてください。");
        return;
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

  const eyeLayers = draft.layers.filter((layer) => layer.part === "eye");
  const mouthLayers = draft.layers.filter((layer) => layer.part === "mouth");
  const layerOptions = (part: LayerPart) =>
    draft.layers
      .filter((layer) => layer.part === part)
      .map((layer) => ({ id: layer.id, label: `${PART_LABELS[layer.part]}（${layer.id}）` }));

  return (
    <section className="my-4 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={draft.name}
          placeholder="表情セット名（例: リン正面）"
          className={`min-w-[200px] flex-1 ${textFieldClass}`}
          onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
        />
        {entry !== undefined && (
          <button
            type="button"
            className={buttonDangerClass}
            disabled={remove.isPending}
            onClick={() => {
              if (window.confirm(`「${entry.name || entry.id}」を削除しますか？`)) {
                remove.mutate(entry.id);
              }
            }}
          >
            削除
          </button>
        )}
      </div>

      <div className="mt-3 border-t border-dashed border-border pt-2">
        <p className="mb-1 text-sm font-medium">顔レイヤー（立ち絵と同じ寸法の透過画像）</p>
        {draft.layers.map((layer, index) => (
          <div key={layer.id} className="my-2 rounded border border-border p-2">
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
                <LayerSelect
                  label="閉眼"
                  value={layer.blinkLayerId}
                  options={eyeLayers
                    .filter((candidate) => candidate.id !== layer.id)
                    .map((candidate) => ({ id: candidate.id, label: candidate.id }))}
                  onChange={(blinkLayerId) => patchLayer(layer.id, { blinkLayerId })}
                />
              )}
              {layer.part === "mouth" && (
                <LayerSelect
                  label="開口"
                  value={layer.speakingLayerId}
                  options={mouthLayers
                    .filter((candidate) => candidate.id !== layer.id)
                    .map((candidate) => ({ id: candidate.id, label: candidate.id }))}
                  onChange={(speakingLayerId) => patchLayer(layer.id, { speakingLayerId })}
                />
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
                          candidate.blinkLayerId === layer.id ? null : candidate.blinkLayerId,
                        speakingLayerId:
                          candidate.speakingLayerId === layer.id ? null : candidate.speakingLayerId,
                      })),
                    expressions: current.expressions.map((preset) => ({
                      ...preset,
                      browLayerId: preset.browLayerId === layer.id ? null : preset.browLayerId,
                      eyeLayerId: preset.eyeLayerId === layer.id ? null : preset.eyeLayerId,
                      mouthLayerId: preset.mouthLayerId === layer.id ? null : preset.mouthLayerId,
                    })),
                  }))
                }
              >
                レイヤーを削除
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          className={buttonNeutralClass}
          onClick={() => setDraft((current) => ({ ...current, layers: [...current.layers, emptyLayer()] }))}
        >
          レイヤーを追加
        </button>
      </div>

      <div className="mt-3 border-t border-dashed border-border pt-2">
        <p className="mb-1 text-sm font-medium">表情プリセット（normal は必須）</p>
        {draft.expressions.map((preset) => (
          <div key={preset.id} className="my-2 rounded border border-border p-2">
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-1.5">
                表示名
                <input
                  value={preset.name}
                  placeholder="例: 笑い"
                  className={textFieldClass}
                  onChange={(event) => patchPreset(preset.id, { name: event.target.value })}
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
                onChange={(browLayerId) => patchPreset(preset.id, { browLayerId })}
              />
              <LayerSelect
                label="目"
                value={preset.eyeLayerId}
                options={layerOptions("eye")}
                onChange={(eyeLayerId) => patchPreset(preset.id, { eyeLayerId })}
              />
              <LayerSelect
                label="口"
                value={preset.mouthLayerId}
                options={layerOptions("mouth")}
                onChange={(mouthLayerId) => patchPreset(preset.id, { mouthLayerId })}
              />
            </div>
          </div>
        ))}
        <button
          type="button"
          className={buttonNeutralClass}
          onClick={() =>
            setDraft((current) => ({ ...current, expressions: [...current.expressions, emptyPreset()] }))
          }
        >
          表情を追加
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={buttonPrimaryClass}
          disabled={mutation.isPending}
          onClick={save}
        >
          {entry === undefined ? "追加" : "保存"}
        </button>
        {entry !== undefined && <span className={metaTextClass}>{entry.id}</span>}
      </div>
      {issue !== null && <p className={errorTextClass}>{issue}</p>}
      {mutation.isError && <p className={errorTextClass}>{errorMessage(mutation.error)}</p>}
      {remove.isError && <p className={errorTextClass}>{errorMessage(remove.error)}</p>}
    </section>
  );
}

export function FaceSetPage() {
  const faceSets = useFaceSets();

  return (
    <section>
      <h1 className="my-3 text-2xl font-bold">表情セット</h1>
      <p className={metaTextClass}>
        互換な外観で共有する顔素材を登録します。ベース立ち絵と同じ寸法の透過画像を眉・目・口・前景に分け、表情ごとに組み合わせます。外観に割り当てると、台詞ごとに表情を切り替えられます。
      </p>

      {faceSets.isLoading && <p>読み込み中…</p>}
      {faceSets.isError && <p className={errorTextClass}>{errorMessage(faceSets.error)}</p>}
      {faceSets.data !== undefined && faceSets.data.length === 0 && (
        <p className={metaTextClass}>表情セットがありません。下のフォームから追加してください。</p>
      )}

      {faceSets.data?.map((entry) => <FaceSetForm key={entry.id} entry={entry} />)}

      <FaceSetForm />
    </section>
  );
}
