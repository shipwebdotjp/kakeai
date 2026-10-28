import { useEffect, useMemo, useState } from "react";
import { SUPPORTED_LOCALES, type SupportedLocale } from "@kakeai/contracts";
import { useCreateLanguageEdition } from "../api/hooks";
import { errorMessage } from "../lib/errorMessage";
import {
  buttonNeutralClass,
  buttonPrimaryClass,
  errorTextClass,
  metaTextClass,
  textFieldClass,
} from "../ui";
import { Modal } from "./Modal";

const ADD_EDITION_VALUE = "__add_edition__";

export function EditionSelector({
  editions,
  editionId,
  onSelect,
  onCreated,
  createEdition,
}: {
  editions: { id: string; locale: string }[];
  editionId: string | undefined;
  onSelect: (id: string) => void;
  onCreated: (id: string) => void;
  createEdition: ReturnType<typeof useCreateLanguageEdition>;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [localeDraft, setLocaleDraft] = useState<SupportedLocale>("en-US");
  const creatableLocales = useMemo(() => {
    const existingLocales = new Set(editions.map((edition) => edition.locale));
    return SUPPORTED_LOCALES.filter((locale) => !existingLocales.has(locale));
  }, [editions]);
  const sourceLocale = editions.find((edition) => edition.id === editionId)?.locale;

  useEffect(() => {
    if (!creatableLocales.includes(localeDraft) && creatableLocales[0] !== undefined) {
      setLocaleDraft(creatableLocales[0]);
    }
  }, [creatableLocales, localeDraft]);

  useEffect(() => {
    setAddOpen(false);
  }, [editionId]);

  useEffect(() => {
    if (creatableLocales.length === 0) {
      setAddOpen(false);
    }
  }, [creatableLocales.length]);

  const closeAdd = () => {
    if (createEdition.isPending) {
      return;
    }
    setAddOpen(false);
  };

  const submitAdd = () => {
    if (editionId === undefined || createEdition.isPending) {
      return;
    }
    createEdition.mutate(
      { locale: localeDraft, sourceEditionId: editionId },
      {
        onSuccess: (work) => {
          setAddOpen(false);
          const created = work.languageEditions.find(
            (edition) => edition.locale === localeDraft,
          );
          if (created !== undefined) {
            onCreated(created.id);
          }
        },
      },
    );
  };

  return (
    <>
      <label className="flex shrink-0 items-center gap-2 text-sm">
        言語版
        <select
          value={editionId ?? ""}
          onChange={(event) => {
            if (event.target.value === ADD_EDITION_VALUE) {
              createEdition.reset();
              setAddOpen(true);
              return;
            }
            onSelect(event.target.value);
          }}
          className={textFieldClass}
        >
          {editions.map((edition) => (
            <option key={edition.id} value={edition.id}>
              {edition.locale}
            </option>
          ))}
          {creatableLocales.length > 0 && editionId !== undefined && (
            <option value={ADD_EDITION_VALUE}>＋ 新規言語版を追加</option>
          )}
        </select>
      </label>

      <Modal
        open={addOpen}
        onClose={closeAdd}
        title="新規言語版を追加"
        className="max-w-md"
      >
        <form
          className="flex flex-col gap-3 text-sm"
          onSubmit={(event) => {
            event.preventDefault();
            submitAdd();
          }}
        >
          <p className={metaTextClass}>
            {sourceLocale === undefined
              ? "現在の言語版の内容を引き継いで新しい言語版を作成します。"
              : `「${sourceLocale}」版の現在内容を引き継いで新しい言語版を作成します。`}
          </p>
          <label className="flex flex-col gap-1">
            追加する言語
            <select
              value={localeDraft}
              onChange={(event) => setLocaleDraft(event.target.value as SupportedLocale)}
              className={textFieldClass}
              aria-label="追加する言語"
              disabled={createEdition.isPending}
            >
              {creatableLocales.map((locale) => (
                <option key={locale} value={locale}>
                  {locale}
                </option>
              ))}
            </select>
          </label>
          {createEdition.isError && (
            <p className={errorTextClass}>{errorMessage(createEdition.error)}</p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className={buttonNeutralClass}
              onClick={closeAdd}
              disabled={createEdition.isPending}
            >
              キャンセル
            </button>
            <button
              type="submit"
              className={buttonPrimaryClass}
              disabled={createEdition.isPending || editionId === undefined}
            >
              作成
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
