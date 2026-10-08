import { useEffect, useState } from "react";
import {
  useFieldArray,
  useForm,
  useWatch,
  type Control,
  type UseFormRegister,
} from "react-hook-form";
import {
  contentDocumentSchema,
  type ContentDocument,
  type Warning,
} from "@kakeai/contracts";
import { useSaveScriptVersion } from "../api/hooks";
import { buildContentDocument, toFormValues, type DocumentFormValues } from "../content/form";
import { errorMessage } from "../lib/errorMessage";
import { LinesEditor } from "./LinesEditor";

interface SceneEditorProps {
  base: ContentDocument;
  editionId: string;
}

const SCENE_LABELS: Record<string, string> = {
  intro: "導入",
  point: "要点",
  outro: "結び",
};

interface TimingFieldsProps {
  control: Control<DocumentFormValues>;
  register: UseFormRegister<DocumentFormValues>;
  sceneIndex: number;
}

function TimingFields({ control, register, sceneIndex }: TimingFieldsProps) {
  const mode = useWatch({ control, name: `scenes.${sceneIndex}.timingMode` });
  return (
    <div className="row">
      <label className="inline">
        アクセント色
        <input type="color" {...register(`scenes.${sceneIndex}.accentColor`)} />
      </label>
      <label className="inline">
        尺
        <select {...register(`scenes.${sceneIndex}.timingMode`)}>
          <option value="auto">自動</option>
          <option value="fixed">固定</option>
        </select>
      </label>
      {mode === "fixed" && (
        <label className="inline">
          固定尺(ms)
          <input
            type="number"
            min={1}
            {...register(`scenes.${sceneIndex}.durationMs`, { valueAsNumber: true })}
          />
        </label>
      )}
    </div>
  );
}

export function SceneEditor({ base, editionId }: SceneEditorProps) {
  const save = useSaveScriptVersion(editionId);
  const [issues, setIssues] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [savedAtMs, setSavedAtMs] = useState<number | null>(null);

  useEffect(() => {
    if (savedAtMs === null) {
      return;
    }
    const timer = setTimeout(() => setSavedAtMs(null), 4000);
    return () => clearTimeout(timer);
  }, [savedAtMs]);

  const { register, control, handleSubmit, reset } = useForm<DocumentFormValues>({
    defaultValues: toFormValues(base),
  });
  const { fields } = useFieldArray({ control, name: "scenes" });

  useEffect(() => {
    reset(toFormValues(base));
  }, [base, reset]);

  const onSubmit = handleSubmit((values) => {
    let document: ContentDocument;
    try {
      document = buildContentDocument(base, values);
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
  });

  return (
    <form onSubmit={onSubmit} className="scene-editor">
      <div className="scene-editor-actions">
        <button type="submit" disabled={save.isPending}>
          保存
        </button>
        {savedAtMs !== null && (
          <span className="meta">保存しました（{new Date(savedAtMs).toLocaleTimeString("ja-JP")}）</span>
        )}
        {save.isError && <span className="error">{errorMessage(save.error)}</span>}
      </div>

      {warnings.length > 0 && (
        <div className="warnings">
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
        <div className="issues">
          <strong>入力エラー</strong>
          <ul>
            {issues.map((issue, index) => (
              <li key={index}>{issue}</li>
            ))}
          </ul>
        </div>
      )}

      {fields.map((field, sceneIndex) => {
        const scene = base.scenes[sceneIndex];
        if (scene === undefined) {
          return null;
        }
        return (
          <section key={field.id} className="scene-card">
            <h3>
              {SCENE_LABELS[scene.kind] ?? scene.kind}
              {scene.kind === "point" && ` ${sceneIndex}`}
              <span className="scene-id">{scene.id}</span>
            </h3>

            {scene.kind === "intro" && (
              <>
                <label>
                  タイトル
                  <input {...register(`scenes.${sceneIndex}.slots.title`)} />
                </label>
                <label>
                  サブタイトル
                  <input {...register(`scenes.${sceneIndex}.slots.subtitle`)} />
                </label>
              </>
            )}
            {scene.kind === "point" && (
              <>
                <label>
                  見出し
                  <input {...register(`scenes.${sceneIndex}.slots.heading`)} />
                </label>
                <label>
                  本文
                  <textarea {...register(`scenes.${sceneIndex}.slots.body`)} rows={3} />
                </label>
              </>
            )}
            {scene.kind === "outro" && (
              <label>
                結びの文言
                <input {...register(`scenes.${sceneIndex}.slots.closing`)} />
              </label>
            )}

            <TimingFields control={control} register={register} sceneIndex={sceneIndex} />

            {scene.kind === "point" && (
              <LinesEditor
                control={control}
                register={register}
                sceneIndex={sceneIndex}
                sceneId={scene.id}
              />
            )}
          </section>
        );
      })}
    </form>
  );
}
