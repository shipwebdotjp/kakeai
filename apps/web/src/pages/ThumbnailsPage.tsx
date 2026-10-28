import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  asSupportedLocale,
  SUPPORTED_LOCALES,
  type SupportedLocale,
  type Thumbnail,
  type ThumbnailAppearance,
} from "@kakeai/contracts";
import { ApiError, thumbnailImageUrl } from "../api/client";
import {
  useDeleteThumbnail,
  useFontCatalog,
  useSaveThumbnailAppearance,
  useSetPrimaryThumbnail,
  useThumbnailAppearance,
  useThumbnails,
  useWork,
} from "../api/hooks";
import { ThumbnailAppearanceEditor } from "../components/ThumbnailAppearanceEditor";
import { ThumbnailAppearancePresetPanel } from "../components/ThumbnailAppearancePresetPanel";
import { ThumbnailForm } from "../components/ThumbnailForm";
import { editionLocaleLabel } from "../lib/localeLabels";
import { THUMBNAIL_TEMPLATE_CATALOG } from "../lib/thumbnailTemplate";
import {
  badgeInfoClass,
  buttonDangerClass,
  buttonNeutralClass,
  buttonPrimaryClass,
  errorTextClass,
  metaTextClass,
  sectionCardClass,
  sectionTitleClass,
} from "../ui";

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "操作に失敗しました。";
}

export function ThumbnailsPage() {
  const { workId, editionId } = useParams<{ workId: string; editionId: string }>();
  const work = useWork(workId);
  const thumbnails = useThumbnails(editionId);
  const setPrimary = useSetPrimaryThumbnail(editionId);
  const remove = useDeleteThumbnail(editionId);
  const appearanceQuery = useThumbnailAppearance(workId, editionId);
  const saveAppearance = useSaveThumbnailAppearance(workId, editionId);
  const fontCatalog = useFontCatalog();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [appearanceDraft, setAppearanceDraft] = useState<ThumbnailAppearance | null>(null);
  const [appearanceDirty, setAppearanceDirty] = useState(false);
  const [appearanceError, setAppearanceError] = useState<string | null>(null);
  const appearanceDirtyRef = useRef(false);
  const appearanceRevisionRef = useRef(0);

  const candidates = thumbnails.data ?? [];
  const selected = candidates.find((candidate) => candidate.id === selectedId) ?? null;
  const defaultTemplate = THUMBNAIL_TEMPLATE_CATALOG[0] ?? null;
  const appearanceDefaults = appearanceQuery.data?.defaults ?? null;
  const fontFaces = fontCatalog.data?.faces ?? [];
  const fontCatalogSupported = fontCatalog.data?.supported ?? true;
  const selectedEdition = work.data?.languageEditions.find((entry) => entry.id === editionId);
  const locale: SupportedLocale =
    asSupportedLocale(selectedEdition?.locale) ?? SUPPORTED_LOCALES[0];
  const otherEditions =
    work.data?.languageEditions.filter((entry) => entry.id !== editionId) ?? [];
  const presetBaseName =
    work.data === undefined ? "サムネイル外観" : work.data.title;
  const presetDefaultName = presetBaseName.slice(0, 80).replace(/[\uD800-\uDBFF]$/u, "");

  useEffect(() => {
    appearanceDirtyRef.current = false;
    appearanceRevisionRef.current += 1;
    setAppearanceDraft(null);
    setAppearanceDirty(false);
    setAppearanceError(null);
  }, [editionId]);

  useEffect(() => {
    if (appearanceQuery.data === undefined || appearanceDirtyRef.current) {
      return;
    }
    setAppearanceDraft(appearanceQuery.data.appearance);
    setAppearanceDirty(false);
    setAppearanceError(null);
  }, [appearanceQuery.data]);

  useEffect(() => {
    if (thumbnails.isFetching || !thumbnails.isSuccess) {
      return;
    }
    if (selectedId !== null && !candidates.some((candidate) => candidate.id === selectedId)) {
      setSelectedId(null);
    }
  }, [candidates, selectedId, thumbnails.isFetching, thumbnails.isSuccess]);

  const updateAppearanceDraft = (next: ThumbnailAppearance | null) => {
    setAppearanceDraft(next);
    appearanceDirtyRef.current = true;
    appearanceRevisionRef.current += 1;
    setAppearanceDirty(true);
    setAppearanceError(null);
  };

  const saveAppearanceDraft = () => {
    setAppearanceError(null);
    const submitted = appearanceDraft;
    const revision = appearanceRevisionRef.current;
    saveAppearance
      .mutateAsync(submitted)
      .then((view) => {
        if (appearanceRevisionRef.current === revision) {
          setAppearanceDraft(view.appearance);
          appearanceDirtyRef.current = false;
          setAppearanceDirty(false);
        }
      })
      .catch((error) => {
        if (appearanceRevisionRef.current === revision) {
          setAppearanceError(errorMessage(error));
        }
      });
  };

  return (
    <div className="mx-auto max-w-5xl">
      <p className={metaTextClass}>
        <Link to={workId === undefined ? "/" : `/works/${encodeURIComponent(workId)}`}>
          作品に戻る
        </Link>
      </p>
      <h1 className="mt-2 mb-1 text-lg font-bold">
        サムネイル{work.data !== undefined ? `: ${work.data.title}` : ""}
      </h1>
      <p className={metaTextClass}>
        現在の言語版: {selectedEdition === undefined ? "読み込み中…" : editionLocaleLabel(locale)}
      </p>
      <p className={metaTextClass}>
        YouTube投稿用のサムネイル候補を作成します。候補は言語版ごとに管理し、選んだ1枚を書き出せます。
      </p>

      <section className={sectionCardClass}>
        <h2 className={sectionTitleClass}>共通の見た目（この作品）</h2>
        <p className={metaTextClass}>
          この作品のすべての言語版に適用されます。候補ごとに必要な項目だけ上書きできます。Font
          Face は言語ごとに設定でき、未設定の言語はThemeのフォントを使います。
        </p>
        {appearanceQuery.isLoading && <p className={metaTextClass}>読み込み中…</p>}
        {appearanceQuery.isError && (
          <p className={errorTextClass}>{errorMessage(appearanceQuery.error)}</p>
        )}
        {appearanceQuery.data !== undefined && appearanceDefaults !== null && (
          <>
            <div className="mt-3">
              <ThumbnailAppearanceEditor
                key={`work-${editionId}`}
                base={appearanceDefaults}
                value={appearanceDraft}
                onChange={updateAppearanceDraft}
                fontFaces={fontFaces}
                fontCatalogSupported={fontCatalogSupported}
                idPrefix="work"
                locale={locale}
              />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={buttonPrimaryClass}
                disabled={!appearanceDirty || saveAppearance.isPending}
                onClick={saveAppearanceDraft}
              >
                {saveAppearance.isPending ? "保存中…" : "共通の見た目を保存"}
              </button>
              {appearanceDirty && <span className={metaTextClass}>未保存の変更があります</span>}
              {appearanceError !== null && <span className={errorTextClass}>{appearanceError}</span>}
            </div>
            <ThumbnailAppearancePresetPanel
              key={workId}
              appearanceDraft={appearanceDraft}
              dirty={appearanceDirty}
              defaultName={presetDefaultName}
              onApply={updateAppearanceDraft}
            />
          </>
        )}
      </section>

      <section className={sectionCardClass}>
        <h2 className={sectionTitleClass}>候補</h2>
        {thumbnails.isLoading && <p className={metaTextClass}>読み込み中…</p>}
        {thumbnails.isError && <p className={errorTextClass}>{errorMessage(thumbnails.error)}</p>}
        {listError !== null && <p className={errorTextClass}>{listError}</p>}
        <div className="flex flex-wrap gap-2">
          {candidates.map((candidate) => (
            <div
              key={candidate.id}
              className={`w-48 rounded border p-2 ${
                candidate.id === selectedId ? "border-brand-500" : "border-border"
              }`}
            >
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="truncate text-left text-sm font-medium"
                  onClick={() => setSelectedId(candidate.id)}
                >
                  {candidate.label}
                </button>
                {candidate.isPrimary && <span className={badgeInfoClass}>投稿用</span>}
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                <a
                  className={buttonNeutralClass}
                  href={thumbnailImageUrl(candidate.id)}
                  download
                >
                  書き出し
                </a>
                {!candidate.isPrimary && (
                  <button
                    type="button"
                    className={buttonNeutralClass}
                    onClick={() =>
                      setPrimary.mutate(candidate.id, {
                        onError: (err) => setListError(errorMessage(err)),
                      })
                    }
                  >
                    投稿用にする
                  </button>
                )}
                <button
                  type="button"
                  className={buttonDangerClass}
                  onClick={() => {
                    if (!window.confirm(`「${candidate.label}」を削除しますか？`)) {
                      return;
                    }
                    setListError(null);
                    remove.mutate(candidate.id, {
                      onSuccess: () => {
                        if (selectedId === candidate.id) {
                          setSelectedId(null);
                        }
                      },
                      onError: (err) => setListError(errorMessage(err)),
                    });
                  }}
                >
                  削除
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            className={buttonNeutralClass}
            onClick={() => setSelectedId(null)}
          >
            ＋ 新しい候補
          </button>
        </div>
      </section>

      {editionId === undefined && (
        <p className={errorTextClass}>編集する言語版がありません。</p>
      )}
      {editionId !== undefined && defaultTemplate === null && (
        <p className={errorTextClass}>利用できるサムネイルテンプレートがありません。</p>
      )}
      {editionId !== undefined && defaultTemplate !== null && (
        <section className={sectionCardClass}>
          <h2 className={sectionTitleClass}>{selected === null ? "新しい候補" : "候補を編集"}</h2>
          <ThumbnailForm
            key={`${editionId}-${selected?.id ?? "new"}`}
            editionId={editionId}
            locale={locale}
            otherEditions={otherEditions}
            candidate={selected}
            defaultTemplate={defaultTemplate}
            appearanceDefaults={appearanceDefaults}
            commonAppearance={appearanceQuery.data === undefined ? undefined : appearanceDraft}
            appearanceLoading={appearanceQuery.isLoading}
            fontFaces={fontFaces}
            fontCatalogSupported={fontCatalogSupported}
            onSaved={(thumbnail) => setSelectedId(thumbnail.id)}
          />
        </section>
      )}
    </div>
  );
}
