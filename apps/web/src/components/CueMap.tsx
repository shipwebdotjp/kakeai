import { useMemo, useState, type FocusEvent, type ReactNode } from "react";
import {
  Clock,
  Image as ImageIcon,
  Monitor,
  Shapes,
  Table2,
  Type,
  User,
  type LucideIcon,
} from "lucide-react";
import { getVisualTemplate, type Asset, type CueLayer } from "@kakeai/contracts";
import { renderContentUrl } from "../api/client";
import { useAssets } from "../api/hooks";
import { SCENE_LABELS } from "../content/labels";
import type { CharacterFormValue, SceneFormValue } from "../content/form";
import {
  buildCueMap,
  cueMapLaneOffsetRightPx,
  CUE_MAP_LANE_WIDTH_PX,
  CUE_MAP_MARKER_WIDTH_PX,
  CUE_MAP_NUMBER_WIDTH_PX,
  CUE_MAP_RAIL_WIDTH_PX,
  CUE_MAP_ROW_HEIGHT_PX,
  locatePlaybackActive,
  targetIdToActive,
  type CueMapActive,
  type CueMapAggregateEntry,
  type CueMapBandPlacement,
  type CueMapCueInfo,
  type CueMapMarker,
  type CueMapRow,
  type CueMapSceneRail,
  type CueMapSeek,
} from "../content/cueMap";
import { usePreviewTime } from "../lib/PreviewController";
import { focusRingClass, metaTextClass } from "../ui";

const LAYER_LABELS: Record<CueLayer, string> = {
  background: "背景",
  card: "カード",
  standing: "立ち絵",
  overlay: "オーバーレイ",
};

const LAYER_BAR_CLASS: Record<CueLayer, string> = {
  background: "bg-sky-500/60",
  card: "bg-violet-500/60",
  standing: "bg-emerald-500/60",
  overlay: "bg-amber-500/70",
};

const LAYER_DOT_CLASS: Record<CueLayer, string> = {
  background: "bg-sky-500",
  card: "bg-violet-500",
  standing: "bg-emerald-500",
  overlay: "bg-amber-500",
};

function categoryIcon(category: string | undefined): LucideIcon {
  switch (category) {
    case "text":
      return Type;
    case "media":
      return ImageIcon;
    case "character":
      return User;
    case "data":
      return Table2;
    case "composition":
      return Monitor;
    default:
      return Shapes;
  }
}

function rangeText(info: CueMapCueInfo): string {
  const detail = info.rangeDetail;
  if (detail.kind === "scene") {
    return info.spanFallback ? "シーン全体（範囲未解決）" : "シーン全体";
  }
  if (detail.kind === "lines") {
    const base =
      detail.startNumber === detail.endNumber
        ? `セリフ区間 ${detail.startNumber}`
        : `セリフ区間 ${detail.startNumber}〜${detail.endNumber}`;
    return info.spanFallback ? `${base}（範囲未解決）` : base;
  }
  return `時間指定 ${detail.startMs}〜${detail.endMs}ms`;
}

function bandLabel(info: CueMapCueInfo): string {
  const parts = [info.templateLabel, LAYER_LABELS[info.layer] ?? info.layer, `順序${info.order}`];
  if (info.isStanding && info.characterName !== null) {
    parts.push(info.characterName);
  }
  parts.push(rangeText(info));
  return parts.join("／");
}

function CueThumb({
  asset,
  sizeClass,
  roundedClass,
}: {
  asset: Asset | undefined;
  sizeClass: string;
  roundedClass?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (asset === undefined || failed) {
    return null;
  }
  const url = renderContentUrl(asset.id);
  const rounded = roundedClass ?? "rounded";
  if (asset.kind === "image") {
    return (
      <img
        src={url}
        alt=""
        aria-hidden="true"
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className={`${sizeClass} ${rounded} border border-border object-cover`}
      />
    );
  }
  if (asset.kind === "video") {
    return (
      <video
        src={url}
        muted
        playsInline
        preload="metadata"
        aria-hidden="true"
        onError={() => setFailed(true)}
        className={`${sizeClass} ${rounded} pointer-events-none border border-border bg-black object-cover`}
      />
    );
  }
  return null;
}

function CueMarkerChip({
  info,
  assetById,
  thumbClass,
}: {
  info: CueMapCueInfo;
  assetById: ReadonlyMap<string, Asset>;
  thumbClass: string;
}) {
  const asset =
    info.representativeAssetId === null
      ? undefined
      : assetById.get(info.representativeAssetId);
  const Icon = categoryIcon(
    getVisualTemplate(info.templateId, info.templateVersion)?.display.category,
  );
  return (
    <span
      className={`relative flex ${thumbClass} items-center justify-center overflow-hidden rounded border border-border bg-surface`}
    >
      <CueThumb asset={asset} sizeClass="h-full w-full" roundedClass="rounded-none border-0" />
      {(asset === undefined || asset.kind === "audio") && (
        <Icon aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground" />
      )}
      <span
        aria-hidden="true"
        className={`absolute bottom-0 left-0 h-1 w-full ${LAYER_DOT_CLASS[info.layer] ?? "bg-border"}`}
      />
    </span>
  );
}

function CuePopoverBody({
  info,
  assetById,
}: {
  info: CueMapCueInfo;
  assetById: ReadonlyMap<string, Asset>;
}) {
  const representative =
    info.representativeAssetId === null
      ? undefined
      : assetById.get(info.representativeAssetId);
  const extraIds = info.assetIds.filter((id) => id !== info.representativeAssetId);
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold break-words">
        {info.templateLabel}@{info.templateVersion}
      </p>
      <p className={metaTextClass}>
        {LAYER_LABELS[info.layer] ?? info.layer}／順序{info.order}
      </p>
      <p className={metaTextClass}>{rangeText(info)}</p>
      {info.isStanding && info.characterName !== null && (
        <p className={metaTextClass}>{info.characterName}</p>
      )}
      {representative !== undefined && (
        <CueThumb asset={representative} sizeClass="h-24 w-full" />
      )}
      {extraIds.length > 0 && (
        <ul className="m-0 list-none space-y-0.5 p-0">
          {extraIds.map((id) => (
            <li key={id} className="truncate text-xs text-muted-foreground">
              {assetById.get(id)?.originalFilename ?? id}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PopoverFrame({ children }: { children: ReactNode }) {
  return (
    <div
      role="dialog"
      className="absolute top-0 right-full z-30 mr-1 w-52 rounded-md border border-border bg-surface p-2 shadow-xl"
    >
      {children}
    </div>
  );
}

function dismissOnBlur(onClose: () => void) {
  return (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      onClose();
    }
  };
}

interface BandWithSceneStart extends CueMapBandPlacement {
  sceneStartRow: number;
}

interface MarkerWithSceneStart extends CueMapMarker {
  sceneStartRow: number;
}

interface ActiveRow extends CueMapRow {
  active: boolean;
}

function CueBandView({
  band,
  laneSpan,
  assetById,
  open,
  onOpen,
  onClose,
  onJump,
}: {
  band: BandWithSceneStart;
  laneSpan: number;
  assetById: ReadonlyMap<string, Asset>;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onJump: (targetId: string, seek: CueMapSeek) => void;
}) {
  const top = (band.startRow - band.sceneStartRow) * CUE_MAP_ROW_HEIGHT_PX;
  const height = (band.endRow - band.startRow + 1) * CUE_MAP_ROW_HEIGHT_PX;
  return (
    <div
      className="absolute"
      style={{
        right: cueMapLaneOffsetRightPx(band.lane, laneSpan),
        width: CUE_MAP_LANE_WIDTH_PX,
        top,
        height,
        pointerEvents: "none",
      }}
    >
      <div
        className="relative h-full w-full"
        onMouseEnter={onOpen}
        onMouseLeave={onClose}
        onBlur={dismissOnBlur(onClose)}
      >
        <button
          type="button"
          aria-label={bandLabel(band)}
          aria-current={band.active ? "true" : undefined}
          onClick={() => {
            onClose();
            onJump(band.jumpTargetId, band.jumpSeek);
          }}
          onFocus={onOpen}
          style={{ pointerEvents: "auto" }}
          className={`absolute inset-0 rounded ${focusRingClass} ${
            band.active ? "outline-2 outline-brand-500" : ""
          }`}
        >
          <span
            aria-hidden="true"
            className={`absolute top-0 bottom-0 left-1/2 w-2.5 -translate-x-1/2 rounded-full ${LAYER_BAR_CLASS[band.layer] ?? "bg-border"}`}
          />
          <span aria-hidden="true" className="absolute top-0 left-1/2 -translate-x-1/2">
            <CueMarkerChip info={band} assetById={assetById} thumbClass="h-7 w-7" />
          </span>
        </button>
        {open && (
          <div style={{ pointerEvents: "auto" }} className="absolute top-0 left-0">
            <PopoverFrame>
              <CuePopoverBody info={band} assetById={assetById} />
            </PopoverFrame>
          </div>
        )}
      </div>
    </div>
  );
}

function AggregateLaneView({
  lane,
  laneSpan,
  entries,
  assetById,
  open,
  onOpen,
  onClose,
  onJump,
}: {
  lane: number;
  laneSpan: number;
  entries: CueMapAggregateEntry[];
  assetById: ReadonlyMap<string, Asset>;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onJump: (targetId: string, seek: CueMapSeek) => void;
}) {
  return (
    <div
      className="absolute top-0 bottom-0"
      style={{
        right: cueMapLaneOffsetRightPx(lane, laneSpan),
        width: CUE_MAP_LANE_WIDTH_PX,
        pointerEvents: "none",
      }}
    >
      <div
        className="relative h-full w-full"
        onMouseEnter={onOpen}
        onMouseLeave={onClose}
        onBlur={dismissOnBlur(onClose)}
      >
        <button
          type="button"
          aria-label={`表示しきれない映像演出 ${entries.length}件`}
          aria-expanded={open}
          onClick={() => (open ? onClose() : onOpen())}
          onFocus={onOpen}
          style={{ pointerEvents: "auto" }}
          className={`absolute top-0 left-1/2 flex -translate-x-1/2 items-start justify-center rounded ${focusRingClass}`}
        >
          <span className="rounded-full border border-border bg-surface-muted px-1.5 py-0.5 text-[11px] leading-tight font-semibold whitespace-nowrap">
            +{entries.length}
          </span>
        </button>
        {open && (
          <div style={{ pointerEvents: "auto" }} className="absolute top-0 left-0">
            <PopoverFrame>
              <ul className="m-0 list-none space-y-1 p-0">
                {entries.map((entry) => (
                    <li key={entry.cueId}>
                      <button
                        type="button"
                        aria-label={bandLabel(entry)}
                        onClick={() => {
                          onClose();
                          onJump(entry.jumpTargetId, entry.jumpSeek);
                        }}
                        className={`flex w-full items-center gap-1.5 rounded p-1 text-left hover:bg-surface-muted ${focusRingClass}`}
                      >
                        <span
                          aria-hidden="true"
                          className={`h-4 w-1.5 shrink-0 rounded-full ${LAYER_DOT_CLASS[entry.layer] ?? "bg-border"}`}
                        />
                        <CueMarkerChip
                          info={entry}
                          assetById={assetById}
                          thumbClass="h-6 w-6 shrink-0"
                        />
                        <span className="min-w-0 flex-1 truncate text-xs">
                          {entry.templateLabel}／{rangeText(entry)}
                        </span>
                      </button>
                    </li>
                ))}
              </ul>
            </PopoverFrame>
          </div>
        )}
      </div>
    </div>
  );
}

function RailMarkerView({
  marker,
  assetById,
  open,
  onOpen,
  onClose,
  onJump,
}: {
  marker: MarkerWithSceneStart;
  assetById: ReadonlyMap<string, Asset>;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onJump: (targetId: string, seek: CueMapSeek) => void;
}) {
  const top = (marker.railRow - marker.sceneStartRow) * CUE_MAP_ROW_HEIGHT_PX;
  return (
    <div className="absolute left-0 z-10" style={{ top, width: CUE_MAP_MARKER_WIDTH_PX }}>
      <div
        className="relative"
        onMouseEnter={onOpen}
        onMouseLeave={onClose}
        onBlur={dismissOnBlur(onClose)}
      >
        <button
          type="button"
          aria-label={`${bandLabel(marker)}（時間指定のため帯なし）`}
          onClick={() => {
            onClose();
            onJump(marker.jumpTargetId, marker.jumpSeek);
          }}
          onFocus={onOpen}
          className={`flex h-6 w-full items-center justify-center rounded text-muted-foreground hover:text-foreground ${focusRingClass}`}
        >
          <Clock aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
        {open && (
          <div className="absolute top-0 left-full z-30 ml-1 w-52 rounded-md border border-border bg-surface p-2 shadow-xl">
            <CuePopoverBody info={marker} assetById={assetById} />
          </div>
        )}
      </div>
    </div>
  );
}

function SceneSection({
  rail,
  rows,
  bands,
  aggregateEntries,
  aggregateLane,
  markers,
  laneSpan,
  assetById,
  openId,
  onOpen,
  onClose,
  onJump,
}: {
  rail: CueMapSceneRail;
  rows: ActiveRow[];
  bands: BandWithSceneStart[];
  aggregateEntries: CueMapAggregateEntry[];
  aggregateLane: number | null;
  markers: MarkerWithSceneStart[];
  laneSpan: number;
  assetById: ReadonlyMap<string, Asset>;
  openId: string | null;
  onOpen: (id: string) => void;
  onClose: () => void;
  onJump: (targetId: string, seek: CueMapSeek) => void;
}) {
  const height = (rail.endRow - rail.startRow + 1) * CUE_MAP_ROW_HEIGHT_PX;
  const railActive = bands.some((band) => band.active) || markers.some((marker) => marker.active);
  const gutterWidthPx = markers.length > 0 ? CUE_MAP_MARKER_WIDTH_PX : 0;
  return (
    <div className="border-b border-border py-0.5 last:border-b-0">
      <div className="flex gap-1.5">
        <div className="relative shrink-0" style={{ width: CUE_MAP_RAIL_WIDTH_PX, height }}>
          <button
            type="button"
            aria-label={`シーン ${rail.label} へ移動`}
            aria-current={railActive ? "true" : undefined}
            onClick={() => onJump(`scene-${rail.sceneId}`, { kind: "scene", id: rail.sceneId })}
            style={{ writingMode: "vertical-rl" }}
            className={`flex h-full w-full items-center justify-center gap-1 rounded py-1 text-xs font-medium hover:bg-border/50 ${focusRingClass} ${
              railActive ? "bg-border/60 font-semibold" : "text-muted-foreground"
            }`}
          >
            <span className="shrink-0 rounded bg-surface-muted px-0.5 py-1 text-[10px] leading-none">
              {SCENE_LABELS[rail.kind] ?? rail.kind}
            </span>
            <span className="truncate">{rail.label}</span>
          </button>
        </div>
        <div
          className="relative min-w-0 flex-1"
          style={{ paddingLeft: gutterWidthPx }}
        >
          {markers.map((marker) => (
            <RailMarkerView
              key={marker.cueId}
              marker={marker}
              assetById={assetById}
              open={openId === `marker-${marker.cueId}`}
              onOpen={() => onOpen(`marker-${marker.cueId}`)}
              onClose={onClose}
              onJump={onJump}
            />
          ))}
          {rows.map((row) =>
            row.kind === "line" && row.lineId !== null ? (
              <button
                key={row.index}
                type="button"
                aria-label={`${row.displayNumber} ${row.captionHead} へ移動`}
                aria-current={row.active ? "true" : undefined}
                onClick={() =>
                  row.lineId !== null &&
                  onJump(`line-${row.lineId}`, { kind: "line", id: row.lineId })
                }
                style={{ height: CUE_MAP_ROW_HEIGHT_PX }}
                className={`flex w-full items-center gap-1 rounded text-left ${focusRingClass} ${
                  row.active ? "bg-border/60" : "hover:bg-border/30"
                }`}
              >
                <span
                  style={{ width: CUE_MAP_NUMBER_WIDTH_PX - 4 }}
                  className="shrink-0 truncate text-xs text-muted-foreground tabular-nums"
                >
                  {row.displayNumber}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs">{row.captionHead}</span>
              </button>
            ) : (
              <div
                key={row.index}
                style={{ height: CUE_MAP_ROW_HEIGHT_PX }}
                className="flex w-full items-center gap-1"
              >
                <span style={{ width: CUE_MAP_NUMBER_WIDTH_PX - 4 }} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {row.index === rail.startRow ? "（セリフなし）" : ""}
                </span>
              </div>
            ),
          )}
          {bands.map((band) => (
            <CueBandView
              key={band.cueId}
              band={band}
              laneSpan={laneSpan}
              assetById={assetById}
              open={openId === `band-${band.cueId}`}
              onOpen={() => onOpen(`band-${band.cueId}`)}
              onClose={onClose}
              onJump={onJump}
            />
          ))}
          {aggregateLane !== null && aggregateEntries.length > 0 && (
            <AggregateLaneView
              lane={aggregateLane}
              laneSpan={laneSpan}
              entries={aggregateEntries}
              assetById={assetById}
              open={openId === `aggregate-${rail.sceneId}`}
              onOpen={() => onOpen(`aggregate-${rail.sceneId}`)}
              onClose={onClose}
              onJump={onJump}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export function CueMap({
  scenes,
  characters,
  sceneLabels,
  activeTargetId,
  paneWidthPx,
  onJump,
}: {
  scenes: SceneFormValue[];
  characters: CharacterFormValue[];
  sceneLabels: ReadonlyMap<string, string>;
  activeTargetId: string | null;
  paneWidthPx: number;
  onJump: (targetId: string, seek: CueMapSeek) => void;
}) {
  const assetsQuery = useAssets();
  const preview = usePreviewTime();
  const [openId, setOpenId] = useState<string | null>(null);

  const assets = useMemo(() => assetsQuery.data ?? [], [assetsQuery.data]);
  const assetById = useMemo(
    () => new Map(assets.map((asset) => [asset.id, asset])),
    [assets],
  );
  const timeline = preview.timeline;
  const timelineReady = timeline !== undefined && !preview.draft.unreflected;
  const located =
    timeline !== undefined ? locatePlaybackActive(timeline, preview.currentTime * 1000) : null;
  const locatedSceneId = located?.sceneId ?? null;
  const locatedLineId = located?.lineId ?? null;
  const active: CueMapActive = useMemo(() => {
    if (timelineReady && !preview.paused && locatedSceneId !== null) {
      return { sceneId: locatedSceneId, lineId: locatedLineId, cueId: null };
    }
    return targetIdToActive(activeTargetId);
  }, [timelineReady, preview.paused, locatedSceneId, locatedLineId, activeTargetId]);

  const model = useMemo(
    () =>
      buildCueMap({
        scenes,
        characters,
        assets,
        sceneLabels,
        timeline,
        timelineReady,
        paneWidthPx,
        active,
      }),
    [scenes, characters, assets, sceneLabels, timeline, timelineReady, paneWidthPx, active],
  );

  const rowsByRail = useMemo(() => {
    const map = new Map<string, ActiveRow[]>();
    for (const row of model.rows) {
      const list = map.get(row.sceneId) ?? [];
      list.push({ ...row, active: row.lineId !== null && row.lineId === active.lineId });
      map.set(row.sceneId, list);
    }
    return map;
  }, [model, active.lineId]);

  const bandsByRail = useMemo(() => {
    const railById = new Map(model.rails.map((rail) => [rail.sceneId, rail]));
    const map = new Map<string, BandWithSceneStart[]>();
    for (const band of model.bands) {
      const rail = railById.get(band.sceneId);
      const list = map.get(band.sceneId) ?? [];
      list.push({ ...band, sceneStartRow: rail?.startRow ?? band.startRow });
      map.set(band.sceneId, list);
    }
    return map;
  }, [model]);

  const markersByRail = useMemo(() => {
    const railById = new Map(model.rails.map((rail) => [rail.sceneId, rail]));
    const map = new Map<string, MarkerWithSceneStart[]>();
    for (const marker of model.markers) {
      const rail = railById.get(marker.sceneId);
      const list = map.get(marker.sceneId) ?? [];
      list.push({ ...marker, sceneStartRow: rail?.startRow ?? marker.railRow });
      map.set(marker.sceneId, list);
    }
    return map;
  }, [model]);

  return (
    <nav aria-label="構成">
      {model.rails.map((rail) => (
        <SceneSection
          key={rail.sceneId}
          rail={rail}
          rows={rowsByRail.get(rail.sceneId) ?? []}
          bands={bandsByRail.get(rail.sceneId) ?? []}
          aggregateEntries={rail.aggregate?.entries ?? []}
          aggregateLane={rail.aggregate?.lane ?? null}
          markers={markersByRail.get(rail.sceneId) ?? []}
          laneSpan={rail.laneSpan}
          assetById={assetById}
          openId={openId}
          onOpen={setOpenId}
          onClose={() => setOpenId(null)}
          onJump={onJump}
        />
      ))}
    </nav>
  );
}
