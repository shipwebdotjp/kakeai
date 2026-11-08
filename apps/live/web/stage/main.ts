import type {
  LiveCharacterSheet,
  LivePackageShow,
  LiveServerMessage,
  LiveSide,
  StageState,
} from "@kakeai/contracts";
import { openLiveSocket, type LiveSocket, type LiveSocketStatus } from "../shared/socket";
import { StageAudio } from "./audio";
import { StageCharacters } from "./characters";
import { StageCutIn } from "./cut-in";
import { element } from "./elements";
import { StageMaterials } from "./materials";
import {
  loadStagePackageData,
  preloadCharacterImages,
  preloadFonts,
  type StagePackageData,
} from "./package-data";

const previewRequested = new URLSearchParams(window.location.search).get("preview") === "1";

const canvas = element<HTMLDivElement>("stage-canvas");
const overlay = element<HTMLDivElement>("phase-overlay");
const overlayKicker = element<HTMLParagraphElement>("phase-kicker");
const overlayTitle = element<HTMLHeadingElement>("phase-title");
const countdownText = element<HTMLParagraphElement>("phase-countdown");
const layout = element<HTMLDivElement>("live-layout");
const segmentLabel = element<HTMLSpanElement>("segment-label");
const safeModeBadge = element<HTMLSpanElement>("safe-mode-badge");
const thinkingIndicator = element<HTMLDivElement>("thinking-indicator");
const materialSlot = element<HTMLElement>("material-slot");
const commentCard = element<HTMLDivElement>("comment-card");
const commentAuthor = element<HTMLParagraphElement>("comment-author");
const commentText = element<HTMLParagraphElement>("comment-text");
const commentState = element<HTMLParagraphElement>("comment-state");
const captionBand = element<HTMLDivElement>("caption-band");
const captionSpeaker = element<HTMLSpanElement>("caption-speaker");
const captionText = element<HTMLSpanElement>("caption-text");
const pausedOverlay = element<HTMLDivElement>("paused-overlay");
const errorOverlay = element<HTMLDivElement>("error-overlay");
const cutInLayer = element<HTMLDivElement>("cut-in-layer");
const cutInVideo = element<HTMLVideoElement>("cut-in-video");
const previewBadge = element<HTMLDivElement>("preview-badge");
const connectionBadge = element<HTMLDivElement>("connection-badge");

const speakerNames = new Map<LiveSide, string>();
const materials = new StageMaterials(materialSlot);
const characters = new StageCharacters({
  left: element<HTMLElement>("character-left"),
  right: element<HTMLElement>("character-right"),
  names: speakerNames,
});

let state: StageState | null = null;
let socket: LiveSocket | null = null;
let role: "program" | "preview" | null = null;
let liveRunId: string | null = null;
let liveSessionId: string | null = null;
let assetsReady = false;
let readySentForSession: string | null = null;
let currentCaptionKey: string | null = null;
let countdownTimer: number | null = null;

const audio = new StageAudio({
  isProgram: () => role === "program",
  send: (event) => {
    sendEvent({
      kind: event.kind,
      cueId: event.playback.cueId,
      attempt: event.playback.attempt,
      sequence: event.playback.sequence,
      ...(event.error === undefined ? {} : { error: event.error }),
    });
  },
});

const cutIn = new StageCutIn(cutInLayer, cutInVideo, {
  isProgram: () => role === "program",
  send: (event) => {
    sendEvent({
      kind: event.kind,
      cueId: null,
      attempt: event.attempt,
      sequence: event.sequence,
      cutInId: event.cutInId,
      segmentId: event.segmentId,
      ...(event.positionMs === undefined ? {} : { positionMs: event.positionMs }),
      ...(event.error === undefined ? {} : { error: event.error }),
    });
  },
});

previewBadge.hidden = !previewRequested;

function fitCanvas(): void {
  const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  canvas.style.transform = `translate(-50%, -50%) scale(${scale})`;
}

function speakerName(side: LiveSide): string {
  return speakerNames.get(side) ?? (side === "left" ? "左" : "右");
}

function sendEvent(event: {
  kind:
    | "stage_ready"
    | "audio_ended"
    | "audio_error"
    | "cut_in_ended"
    | "cut_in_error"
    | "stage_heartbeat";
  cueId: string | null;
  attempt: number;
  sequence: number;
  cutInId?: string;
  segmentId?: string;
  positionMs?: number;
  error?: string;
}): void {
  if (role !== "program" || liveRunId === null || liveSessionId === null || socket === null) {
    return;
  }
  socket.send({
    type: "stage_event",
    event: {
      kind: event.kind,
      runId: liveRunId,
      sessionId: liveSessionId,
      cueId: event.cueId,
      ...(event.cutInId === undefined ? {} : { cutInId: event.cutInId }),
      ...(event.segmentId === undefined ? {} : { segmentId: event.segmentId }),
      attempt: event.attempt,
      sequence: event.sequence,
      ...(event.positionMs === undefined ? {} : { positionMs: event.positionMs }),
      ...(event.error === undefined ? {} : { error: event.error }),
    },
  });
}

function currentPlaybackFields(): { cueId: string | null; attempt: number; sequence: number } {
  return {
    cueId: state?.playback?.cueId ?? null,
    attempt: state?.playback?.attempt ?? 0,
    sequence: state?.playback?.sequence ?? 0,
  };
}

function sendReadyIfPossible(): void {
  if (!assetsReady || role !== "program" || liveSessionId === null) {
    return;
  }
  if (readySentForSession === liveSessionId) {
    return;
  }
  readySentForSession = liveSessionId;
  sendEvent({ kind: "stage_ready", ...currentPlaybackFields() });
}

function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

function updateCountdown(): void {
  if (state === null || state.phase !== "pre_show") {
    return;
  }
  const startAt = state.show.startAt;
  if (startAt === null) {
    countdownText.hidden = true;
    return;
  }
  const remaining = Date.parse(startAt) - Date.now();
  if (Number.isNaN(remaining)) {
    countdownText.hidden = true;
    return;
  }
  countdownText.hidden = false;
  countdownText.textContent =
    remaining <= 0 ? "まもなく始まります" : `開始まで ${formatCountdown(remaining)}`;
}

function setCountdown(active: boolean): void {
  if (!active) {
    if (countdownTimer !== null) {
      window.clearInterval(countdownTimer);
      countdownTimer = null;
    }
    countdownText.hidden = true;
    return;
  }
  if (countdownTimer !== null) {
    updateCountdown();
    return;
  }
  updateCountdown();
  countdownTimer = window.setInterval(updateCountdown, 1000);
}

function renderCaption(next: StageState): void {
  if (next.caption === null) {
    captionBand.hidden = true;
    currentCaptionKey = null;
    return;
  }
  captionBand.hidden = false;
  captionSpeaker.textContent = speakerName(next.caption.speaker);
  const key = `${next.caption.speaker}:${next.caption.text}`;
  if (key !== currentCaptionKey) {
    currentCaptionKey = key;
    captionText.textContent = next.caption.text;
    captionText.classList.remove("caption-enter");
    void captionText.offsetWidth;
    captionText.classList.add("caption-enter");
  }
}

function renderComment(next: StageState): void {
  const comment = next.comment;
  if (comment === null) {
    commentCard.hidden = true;
    return;
  }
  commentCard.hidden = false;
  commentAuthor.textContent = comment.author;
  commentText.textContent = comment.text;
  commentState.textContent = comment.state === "reading" ? "読み上げ中" : "回答中";
}

function renderLive(next: StageState): void {
  segmentLabel.textContent = next.segment?.label ?? "";
  characters.render(next.characters);
  materials.render(next.material);
  renderCaption(next);
  renderComment(next);
  safeModeBadge.hidden = next.phase !== "safe_mode";
  thinkingIndicator.hidden =
    next.status !== "thinking" ||
    next.phase === "paused" ||
    next.phase === "error" ||
    next.phase === "safe_mode";
}

function render(next: StageState): void {
  state = next;
  const showOverlay = next.phase === "pre_show" || next.phase === "post_show";
  overlay.hidden = !showOverlay;
  layout.hidden = showOverlay;
  canvas.classList.toggle("cut-in-active", next.cutIn !== null);
  pausedOverlay.hidden = next.phase !== "paused";
  errorOverlay.hidden = next.phase !== "error";

  if (next.phase === "pre_show") {
    overlayKicker.textContent = "まもなく始まります";
    overlayTitle.textContent = next.show.title;
    setCountdown(true);
  } else {
    setCountdown(false);
    if (next.phase === "post_show") {
      overlayKicker.textContent = "Kakeai Live";
      overlayTitle.textContent = "本日の配信は終了しました";
    }
  }

  if (!showOverlay) {
    renderLive(next);
  }
  cutIn.render(next);
  audio.update(next.phase, next.playback);
}

function handleMessage(message: LiveServerMessage): void {
  switch (message.type) {
    case "hello":
      liveRunId = message.runId;
      liveSessionId = message.sessionId;
      role = message.role === "stage" ? (message.lease?.role ?? "preview") : null;
      render(message.state);
      sendReadyIfPossible();
      return;
    case "state":
      render(message.state);
      return;
    case "lease":
      if (message.lease.sessionId !== liveSessionId) {
        return;
      }
      role = message.lease.role;
      audio.setProgram(role === "program");
      cutIn.setProgram(role === "program");
      return;
    case "preload":
      audio.setPreload(message.cues);
      return;
    default:
      return;
  }
}

function setConnectionStatus(status: LiveSocketStatus): void {
  document.body.dataset.connection = status;
  if (!previewRequested) {
    connectionBadge.hidden = true;
    return;
  }
  connectionBadge.hidden = status === "open";
  connectionBadge.textContent = status === "connecting" ? "プレビュー接続中" : "プレビュー切断";
}

function applyPackageData(data: StagePackageData): void {
  applyShow(data.show);
  applyCharacters(data.characters);
}

function applyShow(show: LivePackageShow | null): void {
  if (show === null) {
    return;
  }
  materials.setShow(show);
  audio.setCueDurations(show.cues);
  speakerNames.clear();
  for (const speaker of show.speakers) {
    speakerNames.set(speaker.side, speaker.name);
  }
  characters.setNames(speakerNames);
}

function applyCharacters(sheet: LiveCharacterSheet | null): void {
  if (sheet === null) {
    return;
  }
  characters.setSheet(sheet);
  for (const character of sheet.characters) {
    if (!speakerNames.has(character.side)) {
      speakerNames.set(character.side, character.name);
    }
  }
}

async function prepareStageAssets(data: StagePackageData): Promise<void> {
  await Promise.all([
    data.characters === null ? Promise.resolve() : preloadCharacterImages(data.characters),
    preloadFonts(),
  ]);
  assetsReady = true;
  sendReadyIfPossible();
}

async function initialize(): Promise<void> {
  document.body.dataset.connection = "connecting";
  const data = await loadStagePackageData();
  applyPackageData(data);

  socket = openLiveSocket({
    role: "stage",
    preview: previewRequested,
    onMessage: handleMessage,
    onStatus: setConnectionStatus,
  });

  // Heartbeats keep the program lease alive. Preview roles never send one.
  window.setInterval(() => {
    if (role !== "program") {
      return;
    }
    sendEvent({ kind: "stage_heartbeat", ...currentPlaybackFields() });
  }, 10_000);

  void prepareStageAssets(data);
  if (state !== null) {
    render(state);
  }
}

window.addEventListener("resize", fitCanvas);
fitCanvas();
void initialize();
