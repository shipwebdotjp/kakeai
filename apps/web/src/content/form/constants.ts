import {
  characterStandingV1,
  MEDIA_ZOOM_MAX,
  MEDIA_ZOOM_MIN,
  mediaCardV1,
  mediaFullBleedV1,
  sceneDeviceFrameV1,
  type AudioCueRole,
  type StandingSide,
  type StandingEdge,
  type StandingVertical,
  type TransitionPolicy,
} from "@kakeai/contracts";

export const FALLBACK_DURATION_MS = 4000;
export const DEFAULT_BGM_GAIN_DB = -18;
export const DEFAULT_BGM_LOOP = true;
export const AUDIO_CUE_ROLES: readonly AudioCueRole[] = [
  "bgm",
  "sfx",
  "program",
];
export const AUDIO_CUE_ROLE_LABELS: Record<AudioCueRole, string> = {
  bgm: "BGM",
  sfx: "効果音",
  program: "音源",
};

export function defaultAudioGainDb(role: AudioCueRole): number {
  return role === "bgm" ? DEFAULT_BGM_GAIN_DB : 0;
}
export const DEFAULT_STANDING_SCALE = 1;
export const STANDING_EDGE_OPTIONS: readonly {
  value: StandingEdge;
  label: string;
}[] = [
  { value: "tight", label: "ギリギリ" },
  { value: "margin", label: "少し余白あり" },
  { value: "center", label: "中央より" },
];
export const STANDING_VERTICAL_OPTIONS: readonly {
  value: StandingVertical;
  label: string;
}[] = [
  { value: "up", label: "上" },
  { value: "standard", label: "標準" },
  { value: "down", label: "下" },
];
export const STANDING_EDGE_VALUES: readonly StandingEdge[] =
  STANDING_EDGE_OPTIONS.map((option) => option.value);
export const STANDING_VERTICAL_VALUES: readonly StandingVertical[] =
  STANDING_VERTICAL_OPTIONS.map((option) => option.value);
export const MIN_STANDING_SCALE = 0.1;
export const MAX_STANDING_SCALE = 3;
export const STANDING_SCALE_STEP = 0.05;
export const STANDING_SIDES: readonly StandingSide[] = ["left", "right"];
export const DEFAULT_APPEARANCE_EXPRESSION = "normal";
export const DEFAULT_APPEARANCE_POSE = "front";

export const MEDIA_FULL_BLEED_ID = mediaFullBleedV1.id;
export const MEDIA_CARD_ID = mediaCardV1.id;
export const DEVICE_FRAME_ID = sceneDeviceFrameV1.id;
export const STANDING_TEMPLATE_ID = characterStandingV1.id;
export const STANDING_TRANSITION_POLICY: TransitionPolicy =
  characterStandingV1.transitionPolicy;

export const CROP_X_SUFFIX = "__x";
export const CROP_Y_SUFFIX = "__y";
export const CROP_ZOOM_SUFFIX = "__zoom";
export const CROP_CENTER_PERCENT = 50;
export const CROP_ZOOM_MIN_PERCENT = MEDIA_ZOOM_MIN * 100;
export const CROP_ZOOM_MAX_PERCENT = MEDIA_ZOOM_MAX * 100;

export const NESTED_MODE_SUFFIX = "__mode";
export const NESTED_MEDIA_FIT_SUFFIX = "__fit";
export const NESTED_COMPOSITION_VERSION_SUFFIX = "__compver";
export const NESTED_COMPOSITION_FIT_SUFFIX = "__compfit";
export const NESTED_COMPOSITION_ZOOM_SUFFIX = "__compzoom";
export const NESTED_COMPOSITION_POS_X_SUFFIX = "__compposx";
export const NESTED_COMPOSITION_POS_Y_SUFFIX = "__compposy";
export const NESTED_MODE_MEDIA = "media";
export const NESTED_MODE_COMPOSITION = "composition";

export const VIDEO_PLAYBACK_SUFFIX = "__videoPlayback";
export const ANIMATION_DURATION_SUFFIX = "__duration";
