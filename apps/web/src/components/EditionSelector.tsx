import { useEffect, useMemo, useState } from "react";
import { SUPPORTED_LOCALES, type SupportedLocale } from "@kakeai/contracts";
import { useCreateLanguageEdition } from "../api/hooks";
import { buttonNeutralClass, textFieldClass } from "../ui";

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
  const [localeDraft, setLocaleDraft] = useState<SupportedLocale>("en-US");
  const creatableLocales = useMemo(() => {
    const existingLocales = new Set(editions.map((edition) => edition.locale));
    return SUPPORTED_LOCALES.filter((locale) => !existingLocales.has(locale));
  }, [editions]);
  useEffect(() => {
    if (!creatableLocales.includes(localeDraft) && creatableLocales[0] !== undefined) {
      setLocaleDraft(creatableLocales[0]);
    }
  }, [creatableLocales, localeDraft]);

  return (
    <div className="my-2 flex shrink-0 flex-wrap items-center gap-2 text-sm">
      <label className="flex items-center gap-2">
        言語版
        <select
          value={editionId ?? ""}
          onChange={(event) => onSelect(event.target.value)}
          className={textFieldClass}
        >
          {editions.map((edition) => (
            <option key={edition.id} value={edition.id}>
              {edition.locale}
            </option>
          ))}
        </select>
      </label>
      {creatableLocales.length > 0 && editionId !== undefined && (
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            createEdition.mutate(
              { locale: localeDraft, sourceEditionId: editionId },
              {
                onSuccess: (work) => {
                  const created = work.languageEditions.find(
                    (edition) => edition.locale === localeDraft,
                  );
                  if (created !== undefined) {
                    onCreated(created.id);
                  }
                },
              },
            );
          }}
        >
          <select
            value={localeDraft}
            onChange={(event) => setLocaleDraft(event.target.value as SupportedLocale)}
            className={textFieldClass}
            aria-label="追加する言語"
          >
            {creatableLocales.map((locale) => (
              <option key={locale} value={locale}>
                {locale}
              </option>
            ))}
          </select>
          <button type="submit" className={buttonNeutralClass} disabled={createEdition.isPending}>
            言語版を追加
          </button>
        </form>
      )}
    </div>
  );
}
