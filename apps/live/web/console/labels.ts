import type { ConsoleSnapshot } from "@kakeai/contracts";
import type { LiveSocketStatus } from "../shared/socket";

export const STATUS_LABELS: Record<LiveSocketStatus, string> = {
  open: "接続中",
  connecting: "接続待ち",
  closed: "切断",
};

export const PHASE_LABELS: Record<ConsoleSnapshot["phase"], string> = {
  pre_show: "開始前",
  opening: "オープニング",
  script: "本編",
  material: "素材",
  comment: "コメント",
  closing: "クロージング",
  post_show: "終了後",
  paused: "一時停止",
  safe_mode: "安全モード",
  error: "エラー",
};

export function phaseCanPause(phase: ConsoleSnapshot["phase"]): boolean {
  return (
    phase === "opening" ||
    phase === "script" ||
    phase === "material" ||
    phase === "comment" ||
    phase === "closing" ||
    phase === "safe_mode"
  );
}
