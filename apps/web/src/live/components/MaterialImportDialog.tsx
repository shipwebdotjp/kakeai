import { useEffect, useRef, useState } from "react";
import type {
  ImportLiveMaterialRequest,
  LiveMaterialFormat,
  WorkSummary,
} from "@kakeai/contracts";
import { useScriptVersion, useWorks } from "../../api/hooks";
import { Modal } from "../../components/Modal";
import { errorMessage } from "../../lib/errorMessage";
import {
  buttonNeutralClass,
  buttonPrimaryClass,
  errorTextClass,
  metaTextClass,
  textFieldClass,
} from "../../ui";
import {
  buildMaterialImportInput,
  DEFAULT_MATERIAL_DURATION_SECONDS,
  isMaterialDurationValid,
  MATERIAL_FORMAT_OPTIONS,
  MAX_MATERIAL_DURATION_SECONDS,
} from "../model/material-import";

interface MaterialImportDialogProps {
  open: boolean;
  isPending: boolean;
  error: unknown;
  onClose: () => void;
  onImport: (
    input: Omit<ImportLiveMaterialRequest, "expectedRevision">,
  ) => void;
}

function firstEditionWithScript(work: WorkSummary) {
  return work.languageEditions.find(
    (edition) =>
      edition.currentScriptVersion !== undefined &&
      edition.currentScriptVersion !== null,
  );
}

export function MaterialImportDialog({
  open,
  isPending,
  error,
  onClose,
  onImport,
}: MaterialImportDialogProps) {
  const worksQuery = useWorks();
  const [workId, setWorkId] = useState("");
  const [editionId, setEditionId] = useState("");
  const [sceneId, setSceneId] = useState("");
  const [name, setName] = useState("");
  const [format, setFormat] = useState<LiveMaterialFormat>("png");
  const [durationSeconds, setDurationSeconds] = useState(
    String(DEFAULT_MATERIAL_DURATION_SECONDS),
  );

  const works = worksQuery.data ?? [];
  const work = works.find((entry) => entry.id === workId);
  const selectedEdition = work?.languageEditions.find((entry) => entry.id === editionId);
  const edition =
    selectedEdition ??
    (work === undefined || editionId !== ""
      ? undefined
      : firstEditionWithScript(work));
  const scriptVersionId = edition?.currentScriptVersion?.id;
  const scriptQuery = useScriptVersion(scriptVersionId);
  const scenes = scriptQuery.data?.content.scenes ?? [];
  const parsedDurationSeconds = Number(durationSeconds);
  const durationValid =
    Number.isFinite(parsedDurationSeconds) &&
    isMaterialDurationValid(format, parsedDurationSeconds);
  const previousWorkIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      setWorkId("");
      setEditionId("");
      setSceneId("");
      setName("");
      setFormat("png");
      setDurationSeconds(String(DEFAULT_MATERIAL_DURATION_SECONDS));
    }
  }, [open]);

  useEffect(() => {
    if (work === undefined) {
      previousWorkIdRef.current = null;
      return;
    }
    const workChanged = previousWorkIdRef.current !== work.id;
    previousWorkIdRef.current = work.id;
    const selected = work.languageEditions.find((entry) => entry.id === editionId);
    if (!workChanged && selected !== undefined) {
      return;
    }
    const fallback = firstEditionWithScript(work);
    const nextEditionId = fallback?.id ?? "";
    if (nextEditionId !== editionId) {
      setEditionId(nextEditionId);
      setSceneId("");
    }
  }, [editionId, work]);

  const selectedScene = scenes.find((scene) => scene.id === sceneId);

  return (
    <Modal open={open} onClose={onClose} title="WorkのSceneからLive Materialを取り込む">
      <div className="flex flex-col gap-4">
        <p className={metaTextClass}>
          Sceneの内容と画像Assetをこのプログラム専用のスナップショットとして保存します。出力形式は取り込み時に固定されます。Work / Sceneとの参照は来歴だけに残ります。
        </p>

        {worksQuery.isLoading && <p className={metaTextClass}>作品を読み込み中…</p>}
        {worksQuery.isError && (
          <p className={errorTextClass}>{errorMessage(worksQuery.error)}</p>
        )}
        {worksQuery.isSuccess && works.length === 0 && (
          <p className={metaTextClass}>作品がありません。</p>
        )}

        <label className="block text-sm">
          作品
          <select
            className={`mt-1 w-full ${textFieldClass}`}
            value={workId}
            onChange={(event) => {
              setWorkId(event.target.value);
              const nextWork = works.find((entry) => entry.id === event.target.value);
              const nextEdition =
                nextWork === undefined ? undefined : firstEditionWithScript(nextWork);
              setEditionId(nextEdition?.id ?? "");
              setSceneId("");
            }}
          >
            <option value="">作品を選択</option>
            {works.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.title}
              </option>
            ))}
          </select>
        </label>

        {work !== undefined && work.languageEditions.length > 1 && (
          <label className="block text-sm">
            言語版
            <select
              className={`mt-1 w-full ${textFieldClass}`}
              value={edition?.id ?? ""}
              onChange={(event) => {
                setEditionId(event.target.value);
                setSceneId("");
              }}
            >
              {work.languageEditions.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.locale}
                </option>
              ))}
            </select>
          </label>
        )}

        {work !== undefined && scriptVersionId === undefined && (
          <p className={metaTextClass}>現在の台本版がありません。</p>
        )}
        {scriptQuery.isLoading && <p>台本を読み込み中…</p>}
        {scriptQuery.isError && (
          <p className={errorTextClass}>{errorMessage(scriptQuery.error)}</p>
        )}

        {scenes.length > 0 && (
          <label className="block text-sm">
            Scene
            <select
              className={`mt-1 w-full ${textFieldClass}`}
              value={sceneId}
              onChange={(event) => {
                setSceneId(event.target.value);
                const scene = scenes.find((entry) => entry.id === event.target.value);
                setName(scene?.label ?? "");
              }}
            >
              <option value="">Sceneを選択</option>
              {scenes.map((scene) => (
                <option key={scene.id} value={scene.id}>
                  {scene.label}（{scene.kind}、セリフ{scene.lines.length}件）
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="block text-sm">
          書き出し形式
          <select
            className={`mt-1 w-full ${textFieldClass}`}
            value={format}
            onChange={(event) => setFormat(event.target.value as LiveMaterialFormat)}
          >
            {MATERIAL_FORMAT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {format === "mp4" && (
          <label className="block text-sm">
            表示時間（秒）
            <input
              type="number"
              min={0.1}
              max={MAX_MATERIAL_DURATION_SECONDS}
              step={0.1}
              className={`mt-1 w-full ${textFieldClass}`}
              value={durationSeconds}
              onChange={(event) => setDurationSeconds(event.target.value)}
            />
            <span className={metaTextClass}>
              0.1〜{MAX_MATERIAL_DURATION_SECONDS}秒。音声は含まれません。
            </span>
          </label>
        )}

        {sceneId !== "" && (
          <label className="block text-sm">
            素材名
            <input
              className={`mt-1 w-full ${textFieldClass}`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={selectedScene?.label ?? "素材名"}
            />
          </label>
        )}

        {error !== undefined && error !== null && (
          <p className={errorTextClass}>{errorMessage(error)}</p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" className={buttonNeutralClass} onClick={onClose}>
            キャンセル
          </button>
          <button
            type="button"
            className={buttonPrimaryClass}
            disabled={
              workId === "" ||
              sceneId === "" ||
              isPending ||
              !durationValid
            }
            onClick={() =>
              onImport(
                buildMaterialImportInput({
                  workId,
                  sceneId,
                  name,
                  format,
                  durationSeconds: parsedDurationSeconds,
                }),
              )
            }
          >
            {isPending ? "取り込み中…" : "取り込む"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
