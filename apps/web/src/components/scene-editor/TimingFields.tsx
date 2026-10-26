import {
  useWatch,
  type Control,
  type UseFormRegister,
  type UseFormSetValue,
} from "react-hook-form";
import {
  DEFAULT_VISUAL_THEME_REF,
  getVisualTheme,
  type ThemeAccentToken,
} from "@kakeai/contracts";
import {
  type DocumentFormValues,
  type SceneAccentKind,
} from "../../content/form";
import { colorFieldClass, formLabelClass, textFieldClass } from "../../ui";

interface TimingFieldsProps {
  control: Control<DocumentFormValues>;
  register: UseFormRegister<DocumentFormValues>;
  setValue: UseFormSetValue<DocumentFormValues>;
  sceneIndex: number;
  sceneKind: "intro" | "point" | "outro" | "insert";
  insertLoop?: boolean;
}

const THEME_ACCENTS = getVisualTheme(
  DEFAULT_VISUAL_THEME_REF.id,
  DEFAULT_VISUAL_THEME_REF.version,
)?.accents ?? { primary: "#19736D", secondary: "#A84D3E", tertiary: "#80600F" };

const ACCENT_TOKEN_OPTIONS: readonly {
  value: ThemeAccentToken;
  label: string;
}[] = [
  { value: "primary", label: `プライマリ（${THEME_ACCENTS.primary}）` },
  { value: "secondary", label: `セカンダリ（${THEME_ACCENTS.secondary}）` },
  { value: "tertiary", label: `ターシャリ（${THEME_ACCENTS.tertiary}）` },
];

export function TimingFields({
  control,
  register,
  setValue,
  sceneIndex,
  sceneKind,
  insertLoop = false,
}: TimingFieldsProps) {
  const mode = useWatch({ control, name: `scenes.${sceneIndex}.timingMode` });
  const accentKind = useWatch({
    control,
    name: `scenes.${sceneIndex}.accentKind`,
  });
  const accentColor = useWatch({
    control,
    name: `scenes.${sceneIndex}.accentColor`,
  });
  const transitionPreset = useWatch({
    control,
    name: `scenes.${sceneIndex}.transitionPreset`,
  });
  const fixedOnly = sceneKind !== "point";
  return (
    <div className="my-2 flex flex-wrap items-center gap-3">
      <label className={formLabelClass}>
        アクセント
        <select
          className={textFieldClass}
          value={accentKind}
          onChange={(event) => {
            const next = event.target.value as SceneAccentKind;
            setValue(`scenes.${sceneIndex}.accentKind`, next, {
              shouldDirty: true,
            });
            if (next === "custom" && !/^#[0-9A-Fa-f]{6}$/.test(accentColor)) {
              setValue(
                `scenes.${sceneIndex}.accentColor`,
                THEME_ACCENTS.primary,
                {
                  shouldDirty: true,
                },
              );
            }
          }}
        >
          <option value="theme">テーマ色</option>
          <option value="custom">自由色</option>
        </select>
      </label>
      {accentKind === "custom" ? (
        <label className={formLabelClass}>
          自由色
          <input
            type="color"
            className={colorFieldClass}
            {...register(`scenes.${sceneIndex}.accentColor`)}
          />
        </label>
      ) : (
        <label className={formLabelClass}>
          テーマ色
          <select
            className={textFieldClass}
            {...register(`scenes.${sceneIndex}.accentToken`)}
          >
            {ACCENT_TOKEN_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className={formLabelClass}>
        尺
        <select
          className={textFieldClass}
          {...register(`scenes.${sceneIndex}.timingMode`)}
        >
          {!fixedOnly && <option value="auto">自動</option>}
          <option value="fixed">固定</option>
        </select>
      </label>
      {mode === "fixed" && (sceneKind !== "insert" || insertLoop) && (
        <label className={formLabelClass}>
          固定尺(ms)
          <input
            type="number"
            min={1}
            className={`w-24 ${textFieldClass}`}
            {...register(`scenes.${sceneIndex}.durationMs`, {
              valueAsNumber: true,
            })}
          />
        </label>
      )}
      {sceneIndex > 0 && (
        <>
          <label className={formLabelClass}>
            シーン切替
            <select
              className={textFieldClass}
              {...register(`scenes.${sceneIndex}.transitionPreset`)}
            >
              <option value="cut">カット</option>
              <option value="fade">フェード</option>
              <option value="crossfade">クロスフェード</option>
            </select>
          </label>
          {transitionPreset !== "cut" && (
            <label className={formLabelClass}>
              切替尺(ms)
              <input
                type="number"
                min={1}
                className={`w-24 ${textFieldClass}`}
                {...register(`scenes.${sceneIndex}.transitionDurationMs`, {
                  valueAsNumber: true,
                  min: 1,
                })}
              />
            </label>
          )}
        </>
      )}
    </div>
  );
}
