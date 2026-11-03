import { useEffect, useMemo, useState } from "react";
import {
  badgeInfoClass,
  badgeNeutralClass,
  buttonNeutralClass,
  buttonPrimaryClass,
  metaTextClass,
  textFieldClass,
} from "../ui";
import { SCENE_LABELS, type SceneKind } from "../content/labels";
import { Modal } from "./Modal";

export interface ScenePickerTarget {
  id: string;
  label: string;
  kind: SceneKind;
  lineCount: number;
  cueCount: number;
  standingCount: number;
}

interface ScenePickerModalProps {
  open: boolean;
  title: string;
  description: string;
  mode: "single" | "multiple";
  confirmLabel: string;
  scenes: readonly ScenePickerTarget[];
  /** 操作元のシーン。一覧の文書順の位置に読み取り専用で表示し、選択肢にはしない。 */
  sourceSceneId?: string | null;
  /** 操作元の行に付けるバッジ文言（例: 複製元）。 */
  sourceLabel?: string;
  onClose: () => void;
  onSelect: (sceneIds: string[]) => void;
}

function SceneRowContent({
  scene,
  sourceLabel,
}: {
  scene: ScenePickerTarget;
  sourceLabel: string | null;
}) {
  return (
    <>
      <span className={scene.kind === "point" ? badgeInfoClass : badgeNeutralClass}>
        {SCENE_LABELS[scene.kind]}
      </span>
      <span className="min-w-0 flex-1 truncate font-medium">{scene.label}</span>
      {sourceLabel !== null && (
        <span className={badgeNeutralClass} title={sourceLabel}>
          {sourceLabel}
        </span>
      )}
      <span className={metaTextClass}>
        セリフ{scene.lineCount}件・映像演出{scene.cueCount}件
        {scene.standingCount > 0 ? `・立ち絵${scene.standingCount}件` : ""}
      </span>
    </>
  );
}

export function ScenePickerModal({
  open,
  title,
  description,
  mode,
  confirmLabel,
  scenes,
  sourceSceneId = null,
  sourceLabel = "",
  onClose,
  onSelect,
}: ScenePickerModalProps) {
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    if (!open) {
      setSelected([]);
      setFilter("");
    }
  }, [open]);

  const visible = useMemo(() => {
    const query = filter.trim();
    if (query === "") {
      return scenes;
    }
    return scenes.filter(
      (scene) =>
        scene.id === sourceSceneId ||
        scene.label.includes(query) ||
        scene.id.includes(query),
    );
  }, [scenes, filter, sourceSceneId]);

  const hasSelectable = visible.some((scene) => scene.id !== sourceSceneId);

  const toggle = (sceneId: string) => {
    setSelected((previous) =>
      previous.includes(sceneId)
        ? previous.filter((entry) => entry !== sceneId)
        : [...previous, sceneId],
    );
  };

  const confirm = () => {
    onSelect(selected);
    setSelected([]);
    setFilter("");
  };

  const close = () => {
    setSelected([]);
    setFilter("");
    onClose();
  };

  return (
    <Modal open={open} onClose={close} title={title}>
      <p className={metaTextClass}>{description}</p>
      <div className="mt-2">
        <label className="block text-sm">
          絞り込み
          <input
            type="text"
            className={`mt-1 w-full ${textFieldClass}`}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="シーン名で絞り込む"
          />
        </label>
      </div>
      <ul className="mt-2 flex flex-col gap-1">
        {visible.map((scene) => {
          const isSource = scene.id === sourceSceneId;
          if (isSource) {
            return (
              <li key={scene.id}>
                <div
                  aria-disabled="true"
                  className="flex w-full items-center gap-2 rounded border border-dashed border-border bg-surface-muted px-2 py-1 text-left text-sm text-muted-foreground"
                >
                  <SceneRowContent
                    scene={scene}
                    sourceLabel={sourceLabel.length > 0 ? sourceLabel : null}
                  />
                </div>
              </li>
            );
          }
          return (
            <li key={scene.id}>
              {mode === "single" ? (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded border border-border px-2 py-1 text-left text-sm hover:bg-surface-muted"
                  onClick={() => {
                    onSelect([scene.id]);
                    setSelected([]);
                    setFilter("");
                  }}
                >
                  <SceneRowContent scene={scene} sourceLabel={null} />
                </button>
              ) : (
                <label className="flex w-full cursor-pointer items-center gap-2 rounded border border-border px-2 py-1 text-sm hover:bg-surface-muted">
                  <input
                    type="checkbox"
                    checked={selected.includes(scene.id)}
                    onChange={() => toggle(scene.id)}
                  />
                  <SceneRowContent scene={scene} sourceLabel={null} />
                </label>
              )}
            </li>
          );
        })}
      </ul>
      {!hasSelectable && (
        <p className={metaTextClass}>該当するシーンがありません。</p>
      )}
      {mode === "multiple" && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={buttonNeutralClass}
            onClick={close}
          >
            キャンセル
          </button>
          <button
            type="button"
            className={buttonPrimaryClass}
            disabled={selected.length === 0}
            onClick={confirm}
          >
            {confirmLabel}（{selected.length}件）
          </button>
        </div>
      )}
    </Modal>
  );
}
