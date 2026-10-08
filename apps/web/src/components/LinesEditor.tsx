import { useFieldArray, type Control, type UseFormRegister } from "react-hook-form";
import type { DocumentFormValues } from "../content/form";
import { createEmptyLine } from "../content/form";

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
    <div className="lines">
      <h4>セリフ</h4>
      {fields.map((field, lineIndex) => (
        <div key={field.id} className="line-editor">
          <textarea
            {...register(`scenes.${sceneIndex}.lines.${lineIndex}.captionText`)}
            placeholder="字幕テキスト"
            rows={2}
          />
          <input
            {...register(`scenes.${sceneIndex}.lines.${lineIndex}.speechText`)}
            placeholder="読み上げテキスト（TTS用）"
          />
          <button type="button" onClick={() => remove(lineIndex)}>
            セリフを削除
          </button>
        </div>
      ))}
      <button type="button" onClick={() => append(createEmptyLine(sceneId))}>
        セリフを追加
      </button>
    </div>
  );
}
