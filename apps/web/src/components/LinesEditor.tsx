import { useFieldArray, type Control, type UseFormRegister } from "react-hook-form";
import type { DocumentFormValues } from "../content/form";
import { createEmptyLine } from "../content/form";
import { buttonNeutralClass, textFieldClass } from "../ui";

interface LinesEditorProps {
  control: Control<DocumentFormValues>;
  register: UseFormRegister<DocumentFormValues>;
  sceneIndex: number;
  sceneId: string;
}

export function LinesEditor({ control, register, sceneIndex, sceneId }: LinesEditorProps) {
  const { fields, append, remove } = useFieldArray({
    control,
    name: `scenes.${sceneIndex}.lines`,
  });

  return (
    <div className="mt-3 border-t border-dashed border-border pt-2">
      <h4 className="mb-2 font-semibold">セリフ</h4>
      {fields.map((field, lineIndex) => (
        <div key={field.id} className="my-2 grid gap-1.5">
          <textarea
            rows={2}
            placeholder="字幕テキスト"
            className={`block w-full ${textFieldClass}`}
            {...register(`scenes.${sceneIndex}.lines.${lineIndex}.captionText`)}
          />
          <input
            placeholder="読み上げテキスト（TTS用）"
            className={`block w-full ${textFieldClass}`}
            {...register(`scenes.${sceneIndex}.lines.${lineIndex}.speechText`)}
          />
          <button type="button" className={buttonNeutralClass} onClick={() => remove(lineIndex)}>
            セリフを削除
          </button>
        </div>
      ))}
      <button type="button" className={buttonNeutralClass} onClick={() => append(createEmptyLine(sceneId))}>
        セリフを追加
      </button>
    </div>
  );
}
