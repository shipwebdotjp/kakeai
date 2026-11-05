import {
  CROP_CENTER_PERCENT,
  CROP_ZOOM_MAX_PERCENT,
  CROP_ZOOM_MIN_PERCENT,
} from "../content/form";
import { formLabelTextClass, metaTextClass } from "../ui";

const IDENTITY_ZOOM_PERCENT = "100";

export function PositionZoomControls({
  label,
  xKey,
  yKey,
  zoomKey,
  values,
  setField,
  setFields,
  getFields,
}: {
  label?: string;
  xKey: string;
  yKey: string;
  zoomKey?: string;
  values: Record<string, string>;
  setField: (key: string, value: string) => void;
  setFields: (values: Record<string, string>) => void;
  getFields: () => Record<string, string>;
}) {
  const center = String(CROP_CENTER_PERCENT);
  const xValue = values[xKey] ?? "";
  const yValue = values[yKey] ?? "";
  const zoomValue = zoomKey !== undefined ? (values[zoomKey] ?? "") : "";
  const xDisplay = xValue.length > 0 ? xValue : center;
  const yDisplay = yValue.length > 0 ? yValue : center;
  const zoomDisplay = zoomValue.length > 0 ? zoomValue : IDENTITY_ZOOM_PERCENT;
  const isCentered = xValue.length === 0 && yValue.length === 0;
  const moveAxis = (axisKey: string, otherKey: string, next: string) => {
    const otherValue = getFields()[otherKey] ?? "";
    setFields(
      otherValue.length === 0 ? { [axisKey]: next, [otherKey]: center } : { [axisKey]: next },
    );
  };
  return (
    <div className="my-2">
      <div className="flex flex-wrap items-center gap-2">
        {label !== undefined && <span className={formLabelTextClass}>{label}</span>}
        <span className={metaTextClass}>
          横 {xDisplay}% / 縦 {yDisplay}%
        </span>
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
          disabled={isCentered}
          onClick={() => setFields({ [xKey]: "", [yKey]: "" })}
        >
          中央に戻す
        </button>
      </div>
      <label className="mt-1 flex items-center gap-2">
        <span className="w-6 text-xs">横</span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          className="w-48"
          value={xDisplay}
          onChange={(event) => moveAxis(xKey, yKey, event.target.value)}
        />
      </label>
      <label className="mt-1 flex items-center gap-2">
        <span className="w-6 text-xs">縦</span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          className="w-48"
          value={yDisplay}
          onChange={(event) => moveAxis(yKey, xKey, event.target.value)}
        />
      </label>
      {zoomKey !== undefined && (
        <label className="mt-1 flex items-center gap-2">
          <span className="w-6 text-xs">倍率</span>
          <input
            type="range"
            min={CROP_ZOOM_MIN_PERCENT}
            max={CROP_ZOOM_MAX_PERCENT}
            step={1}
            className="w-48"
            value={zoomDisplay}
            onChange={(event) => setField(zoomKey, event.target.value)}
          />
          <span className={metaTextClass}>{zoomDisplay}%</span>
          {zoomValue.length > 0 && (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setField(zoomKey, "")}
            >
              等倍に戻す
            </button>
          )}
        </label>
      )}
    </div>
  );
}
