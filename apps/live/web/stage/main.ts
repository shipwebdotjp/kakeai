import type {
  LivePackageShow,
  LiveServerMessage,
  LiveSide,
  MaterialCard,
  StageCharacterState,
  StageMaterialState,
  StageState,
} from "@kakeai/contracts";
import { openLiveSocket } from "../shared/socket";

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) {
    throw new Error(`ステージ要素が見つかりません: #${id}`);
  }
  return found as T;
}

const canvas = element<HTMLDivElement>("stage-canvas");
const overlay = element<HTMLDivElement>("phase-overlay");
const overlayKicker = element<HTMLParagraphElement>("phase-kicker");
const overlayTitle = element<HTMLHeadingElement>("phase-title");
const countdownText = element<HTMLParagraphElement>("phase-countdown");
const layout = element<HTMLDivElement>("live-layout");
const segmentLabel = element<HTMLSpanElement>("segment-label");
const leftCharacter = element<HTMLElement>("character-left");
const rightCharacter = element<HTMLElement>("character-right");
const materialSlot = element<HTMLElement>("material-slot");
const commentCard = element<HTMLDivElement>("comment-card");
const commentAuthor = element<HTMLParagraphElement>("comment-author");
const commentText = element<HTMLParagraphElement>("comment-text");
const commentState = element<HTMLParagraphElement>("comment-state");
const captionBand = element<HTMLDivElement>("caption-band");
const captionSpeaker = element<HTMLSpanElement>("caption-speaker");
const captionText = element<HTMLSpanElement>("caption-text");
const statusBadge = element<HTMLDivElement>("status-badge");

let state: StageState | null = null;
let liveRunId: string | null = null;
let liveSessionId: string | null = null;
let materials = new Map<string, MaterialCard>();
const speakerNames = new Map<LiveSide, string>();
let currentMaterialKey: string | null = null;
let countdownTimer: number | null = null;

function packageUrl(path: string): string {
  return `/package/${path.split("/").map(encodeURIComponent).join("/")}`;
}

function fitCanvas(): void {
  const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  canvas.style.transform = `translate(-50%, -50%) scale(${scale})`;
}

function speakerName(side: LiveSide): string {
  return speakerNames.get(side) ?? (side === "left" ? "左" : "右");
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

function renderCharacter(
  section: HTMLElement,
  character: StageCharacterState | null,
  side: LiveSide,
): void {
  if (character === null) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  section.classList.toggle("speaking", character.speaking);
  const name = section.querySelector<HTMLParagraphElement>(".character-name");
  const expression = section.querySelector<HTMLParagraphElement>(".character-expression");
  if (name !== null) {
    name.textContent = speakerName(side);
  }
  if (expression !== null) {
    expression.textContent = character.expression;
  }
}

function clearMaterial(): void {
  materialSlot.replaceChildren();
  materialSlot.hidden = true;
  currentMaterialKey = null;
}

function buildMaterialContent(card: MaterialCard): HTMLElement | null {
  switch (card.kind) {
    case "image": {
      const image = document.createElement("img");
      image.src = packageUrl(card.file);
      image.alt = "";
      image.addEventListener("error", () => clearMaterial());
      return image;
    }
    case "video": {
      const video = document.createElement("video");
      video.src = packageUrl(card.file);
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.autoplay = true;
      video.addEventListener("error", () => clearMaterial());
      void video.play().catch(() => undefined);
      return video;
    }
    case "html": {
      const frame = document.createElement("iframe");
      // ADR-0126: static package HTML must not run scripts. Same-origin keeps
      // relative package assets working; `allow-scripts` is deliberately absent.
      frame.setAttribute("sandbox", "allow-same-origin");
      frame.setAttribute("title", "素材カード");
      frame.src = packageUrl(card.file);
      return frame;
    }
    default:
      return null;
  }
}

function renderMaterial(material: StageMaterialState | null): void {
  if (material === null) {
    if (currentMaterialKey !== null) {
      clearMaterial();
    }
    materialSlot.hidden = true;
    return;
  }
  const card = materials.get(material.id);
  if (card === undefined) {
    clearMaterial();
    return;
  }
  const key = `${card.id}:${card.file}`;
  if (key !== currentMaterialKey) {
    const content = buildMaterialContent(card);
    if (content === null) {
      clearMaterial();
      return;
    }
    materialSlot.replaceChildren(content);
    currentMaterialKey = key;
  }
  materialSlot.hidden = false;
  materialSlot.classList.toggle("focus", material.focus);
}

function renderCaption(next: StageState): void {
  if (next.caption === null) {
    captionBand.hidden = true;
    return;
  }
  captionBand.hidden = false;
  captionSpeaker.textContent = speakerName(next.caption.speaker);
  captionText.textContent = next.caption.text;
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

function renderStatusBadge(next: StageState): void {
  let label: string | null = null;
  if (next.phase === "paused") {
    label = "一時停止中";
  } else if (next.phase === "safe_mode") {
    label = "安全モード";
  } else if (next.phase === "error") {
    label = "エラー";
  } else if (next.status === "thinking") {
    label = "考え中";
  }
  statusBadge.hidden = label === null;
  statusBadge.textContent = label ?? "";
}

function renderLive(next: StageState): void {
  segmentLabel.textContent = next.segment?.label ?? "";
  renderCharacter(leftCharacter, next.characters.left, "left");
  renderCharacter(rightCharacter, next.characters.right, "right");
  renderMaterial(next.material);
  renderCaption(next);
  renderComment(next);
  renderStatusBadge(next);
}

function render(next: StageState): void {
  state = next;
  const showOverlay = next.phase === "pre_show" || next.phase === "post_show";
  overlay.hidden = !showOverlay;
  layout.hidden = showOverlay;

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
}

let liveSocket: ReturnType<typeof openLiveSocket> | null = null;

function handleMessage(message: LiveServerMessage): void {
  if (message.type === "hello") {
    liveRunId = message.runId;
    liveSessionId = message.sessionId;
    render(message.state);
    return;
  }
  if (message.type === "state") {
    render(message.state);
  }
}

async function loadShowData(): Promise<void> {
  try {
    const response = await fetch("/package/show.json", { cache: "force-cache" });
    if (!response.ok) {
      return;
    }
    const show = (await response.json()) as LivePackageShow;
    materials = new Map(show.materials.map((card) => [card.id, card]));
    speakerNames.clear();
    for (const speaker of show.speakers) {
      speakerNames.set(speaker.side, speaker.name);
    }
    if (state !== null) {
      render(state);
    }
  } catch {
    // The stage still renders placeholders when package metadata is unavailable.
  }
}

document.body.dataset.connection = "connecting";
liveSocket = openLiveSocket({
  role: "stage",
  onMessage: handleMessage,
  onStatus: (status) => {
    document.body.dataset.connection = status;
    if (status !== "open") {
      statusBadge.hidden = false;
      statusBadge.textContent = status === "connecting" ? "再接続中" : "切断";
      return;
    }
    if (state !== null) {
      renderStatusBadge(state);
    }
  },
});

// Keeps the program lease alive. P3 adds audio_ended/audio_error on the same
// socket; sequence 0 is fine for heartbeats, which never advance playout.
window.setInterval(() => {
  if (liveSocket === null || liveRunId === null || liveSessionId === null) {
    return;
  }
  liveSocket.send({
    type: "stage_event",
    event: {
      kind: "stage_heartbeat",
      runId: liveRunId,
      sessionId: liveSessionId,
      cueId: state?.playback?.cueId ?? null,
      attempt: state?.playback?.attempt ?? 0,
      sequence: 0,
    },
  });
}, 10_000);

window.addEventListener("resize", fitCanvas);
fitCanvas();
void loadShowData();
