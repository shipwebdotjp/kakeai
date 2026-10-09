import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { contentDocumentSchema, type ContentDocument, type Warning } from "@kakeai/contracts";
import { useCurrentScriptVersion, useSaveScriptVersion, useWork } from "../api/hooks";
import { workRoute } from "../lib/routes";
import { MediaPicker } from "../components/MediaPicker";
import {
  buildContentDocument,
  countAppearanceReferences,
  countCharacterReferences,
  createEmptyAppearance,
  createEmptyCharacter,
  toFormValues,
  type AppearanceFormValue,
  type CharacterFormValue,
} from "../content/form";
import { errorMessage } from "../lib/errorMessage";
import {
  buttonDangerClass,
  buttonNeutralClass,
  buttonPrimaryClass,
  errorTextClass,
  metaTextClass,
  textFieldClass,
} from "../ui";

export function CharactersPage() {
  const { workId } = useParams<{ workId: string }>();
  const work = useWork(workId);
  const editionId = work.data?.languageEditions[0]?.id;
  const current = useCurrentScriptVersion(editionId);
  const save = useSaveScriptVersion(editionId);
  const [characters, setCharacters] = useState<CharacterFormValue[] | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [savedAtMs, setSavedAtMs] = useState<number | null>(null);

  const content = current.data?.content;
  const versionId = current.data?.id;

  useEffect(() => {
    setCharacters(content === undefined ? null : toFormValues(content).characters);
  }, [versionId]);

  useEffect(() => {
    if (savedAtMs === null) {
      return;
    }
    const timer = setTimeout(() => setSavedAtMs(null), 4000);
    return () => clearTimeout(timer);
  }, [savedAtMs]);

  const updateCharacter = (id: string, patch: Partial<CharacterFormValue>) => {
    setCharacters((list) =>
      list === null ? list : list.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    );
  };

  const updateAppearance = (
    characterId: string,
    appearanceId: string,
    patch: Partial<AppearanceFormValue>,
  ) => {
    setCharacters((list) =>
      list === null
        ? list
        : list.map((entry) =>
            entry.id === characterId
              ? {
                  ...entry,
                  appearances: entry.appearances.map((appearance) =>
                    appearance.id === appearanceId ? { ...appearance, ...patch } : appearance,
                  ),
                }
              : entry,
          ),
    );
  };

  const addCharacter = () => {
    setCharacters((list) => (list === null ? list : [...list, createEmptyCharacter()]));
  };

  const addAppearance = (characterId: string) => {
    setCharacters((list) =>
      list === null
        ? list
        : list.map((entry) =>
            entry.id === characterId
              ? { ...entry, appearances: [...entry.appearances, createEmptyAppearance()] }
              : entry,
          ),
    );
  };

  const deleteCharacter = (character: CharacterFormValue) => {
    if (content === undefined) {
      return;
    }
    const usage = countCharacterReferences(content, character.id);
    const details: string[] = [];
    if (usage.cues > 0) {
      details.push(`立ち絵 ${usage.cues} 件（${usage.scenes} シーン）`);
    }
    if (usage.speakers > 0) {
      details.push(`話者の参照 ${usage.speakers} 件`);
    }
    const usageText =
      details.length === 0
        ? ""
        : `\n使用中: ${details.join("、")}。保存するとこれらの参照を解除します。`;
    if (window.confirm(`「${character.name || character.id}」を削除しますか？${usageText}`)) {
      setCharacters((list) =>
        list === null ? list : list.filter((entry) => entry.id !== character.id),
      );
    }
  };

  const deleteAppearance = (character: CharacterFormValue, appearance: AppearanceFormValue) => {
    if (content === undefined) {
      return;
    }
    const usage = countAppearanceReferences(content, character.id, appearance.id);
    const usageText =
      usage.cues === 0
        ? ""
        : `\n使用中: 立ち絵 ${usage.cues} 件（${usage.scenes} シーン）。保存するとこれらの参照を解除します。`;
    if (window.confirm(`この外観を削除しますか？${usageText}`)) {
      setCharacters((list) =>
        list === null
          ? list
          : list.map((entry) =>
              entry.id === character.id
                ? {
                    ...entry,
                    appearances: entry.appearances.filter(
                      (candidate) => candidate.id !== appearance.id,
                    ),
                  }
                : entry,
            ),
      );
    }
  };

  const onSave = () => {
    if (content === undefined || characters === null) {
      return;
    }
    let document: ContentDocument;
    try {
      const values = toFormValues(content);
      values.characters = characters;
      document = buildContentDocument(content, values);
    } catch (error) {
      setIssues([errorMessage(error)]);
      setWarnings([]);
      return;
    }
    const parsed = contentDocumentSchema.safeParse(document);
    if (!parsed.success) {
      setIssues(
        parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      );
      setWarnings([]);
      return;
    }
    setIssues([]);
    save.mutate(parsed.data, {
      onSuccess: (result) => {
        setWarnings(result.warnings);
        setSavedAtMs(Date.now());
      },
    });
  };

  return (
    <section>
      <p>
        <Link
          to={workId === undefined ? "/" : workRoute(workId)}
          className="text-brand-700 hover:underline dark:text-brand-400"
        >
          ← 作品の編集
        </Link>
      </p>
      <h1 className="my-3 text-2xl font-bold">キャラクター管理</h1>
      {work.data !== undefined && <p className={metaTextClass}>{work.data.title}</p>}

      {work.isLoading && <p>読み込み中…</p>}
      {work.isError && <p className={errorTextClass}>{errorMessage(work.error)}</p>}
      {current.isError && <p className={errorTextClass}>{errorMessage(current.error)}</p>}
      {work.data !== undefined && editionId === undefined && (
        <p>この作品には言語版がありません。</p>
      )}
      {characters === null && work.data !== undefined && editionId !== undefined && (
        <p>台本を読み込み中…</p>
      )}

      {characters !== null && (
        <>
          <div className="sticky top-0 z-10 flex items-center gap-3 bg-surface py-2.5">
            <button
              type="button"
              className={buttonPrimaryClass}
              disabled={save.isPending}
              onClick={onSave}
            >
              保存
            </button>
            {savedAtMs !== null && (
              <span className={metaTextClass}>
                保存しました（{new Date(savedAtMs).toLocaleTimeString("ja-JP")}）
              </span>
            )}
            {save.isError && <span className={errorTextClass}>{errorMessage(save.error)}</span>}
          </div>

          <p className={metaTextClass}>
            立ち絵に使う画像をキャラクターと外観（表情・ポーズ）として登録します。表情・ポーズが空欄のときは
            normal / front として保存されます。画像は素材ライブラリの準備完了済み画像から選びます。
          </p>

          {warnings.length > 0 && (
            <div className="rounded border border-yellow-400 bg-yellow-50 p-3 text-sm dark:bg-yellow-950/40">
              <strong>警告</strong>
              <ul>
                {warnings.map((warning, index) => (
                  <li key={index}>
                    {warning.path.join(".")}: {warning.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {issues.length > 0 && (
            <div className="rounded border border-red-400 bg-red-50 p-3 text-sm dark:bg-red-950/40">
              <strong>入力エラー</strong>
              <ul>
                {issues.map((issue, index) => (
                  <li key={index}>{issue}</li>
                ))}
              </ul>
            </div>
          )}

          {characters.map((character) => (
            <section key={character.id} className="my-4 rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={character.name}
                  placeholder="キャラクター名"
                  className={`min-w-[200px] flex-1 ${textFieldClass}`}
                  onChange={(event) =>
                    updateCharacter(character.id, { name: event.target.value })
                  }
                />
                <button
                  type="button"
                  className={buttonDangerClass}
                  onClick={() => deleteCharacter(character)}
                >
                  削除
                </button>
              </div>
              <p className={metaTextClass}>{character.id}</p>

              {character.appearances.map((appearance, index) => (
                <div
                  key={appearance.id}
                  className="my-2 rounded border border-border p-2"
                >
                  <MediaPicker
                    label={`外観 ${index + 1} の画像`}
                    kinds={["image"]}
                    selectedAssetId={appearance.assetId}
                    onSelect={(assetId) =>
                      updateAppearance(character.id, appearance.id, { assetId })
                    }
                  />
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="inline-flex items-center gap-1.5">
                      表情
                      <input
                        value={appearance.expression}
                        placeholder="normal"
                        className={textFieldClass}
                        onChange={(event) =>
                          updateAppearance(character.id, appearance.id, {
                            expression: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label className="inline-flex items-center gap-1.5">
                      ポーズ
                      <input
                        value={appearance.pose}
                        placeholder="front"
                        className={textFieldClass}
                        onChange={(event) =>
                          updateAppearance(character.id, appearance.id, {
                            pose: event.target.value,
                          })
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className={buttonDangerClass}
                      onClick={() => deleteAppearance(character, appearance)}
                    >
                      外観を削除
                    </button>
                  </div>
                </div>
              ))}

              <button
                type="button"
                className={buttonNeutralClass}
                onClick={() => addAppearance(character.id)}
              >
                外観を追加
              </button>
            </section>
          ))}

          <button type="button" className={buttonNeutralClass} onClick={addCharacter}>
            キャラクターを追加
          </button>
          {characters.length === 0 && (
            <p className={metaTextClass}>
              キャラクターがありません。「キャラクターを追加」から登録してください。
            </p>
          )}
        </>
      )}
    </section>
  );
}
