import { escapeHtmlAttribute, escapeHtmlText } from "../escape";

/**
 * Shared chrome for device-like frames (`chat.thread@1` and
 * `scene.device-frame@1`): a static status bar and a laptop keyboard base.
 * Both are decorative only and never read the real clock, so preview and
 * render stay identical.
 */

export const DEFAULT_STATUS_TIME = "9:41";

const WIFI_SVG =
  '<svg viewBox="0 0 24 18" aria-hidden="true"><path d="M12 14.4a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4Z"/><path d="M12 9.9c1.9 0 3.6.7 4.9 1.9l-1.7 1.7A4.6 4.6 0 0 0 12 12.2c-1.2 0-2.3.5-3.2 1.3l-1.7-1.7A7 7 0 0 1 12 9.9Z"/><path d="M12 5.2c3.1 0 5.9 1.2 8 3.2l-1.7 1.7A8.8 8.8 0 0 0 12 7.5a8.8 8.8 0 0 0-6.3 2.6l-1.7-1.7A11.2 11.2 0 0 1 12 5.2Z"/></svg>';

const BATTERY_SVG =
  '<svg viewBox="0 0 30 14" fill="none" aria-hidden="true"><rect x="0.8" y="0.8" width="24" height="12.4" rx="3.6" stroke="currentColor" stroke-width="1.6" opacity="0.5"/><rect x="3.2" y="3.2" width="19" height="7.6" rx="2" fill="currentColor"/><path d="M27 4.6c1.5.6 1.5 4.2 0 4.8V4.6Z" fill="currentColor" opacity="0.5"/></svg>';

/**
 * Static status bar: time on the left, a Dynamic Island in the middle, and
 * Wi-Fi / battery on the right. The caller supplies the positioning class
 * (`kakeai-chatstatus` or `kakeai-deviceframe-status`); the inner elements
 * share `kakeai-statusbar-*` classes and size from `--kakeai-status-u`.
 */
export function statusBarHtml(containerClass: string, time?: string): string {
  const label = time === undefined ? DEFAULT_STATUS_TIME : time.trim();
  const timeHtml =
    label.length === 0
      ? '<span class="kakeai-statusbar-time"></span>'
      : `<span class="kakeai-statusbar-time">${escapeHtmlText(label)}</span>`;
  return `<div class="${escapeHtmlAttribute(containerClass)} kakeai-statusbar">${timeHtml}<span class="kakeai-statusbar-island" aria-hidden="true"></span><span class="kakeai-statusbar-icons" aria-hidden="true"><span class="kakeai-statusbar-wifi">${WIFI_SVG}</span><span class="kakeai-statusbar-battery">${BATTERY_SVG}</span></span></div>`;
}

/**
 * Open-laptop base: the deck is projected in 3D so that its far edge meets the
 * screen and its near edge flares toward the viewer. The deck carries the
 * keyboard, trackpad, speaker grilles and the front thumb notch. The outer
 * stage reserves the projected footprint so the layout stays predictable.
 *
 * Keep the stage depth (`29%` of the body width) in sync with the deck geometry
 * in the compiler styles: the deck is 110% wide, 10/7 deep and rotated 70deg
 * under a 365cqw camera, which projects to roughly the same height. The
 * speaker grille pitch is 7.7% of the grille width by 1.1% of its height, so
 * the dots stay square and scale with the deck.
 */
export function laptopBaseHtml(): string {
  return '<div class="kakeai-laptopbase" aria-hidden="true"><div class="kakeai-laptopdeck"><span class="kakeai-laptopspeaker kakeai-laptopspeaker-left"></span><span class="kakeai-laptopspeaker kakeai-laptopspeaker-right"></span><span class="kakeai-laptopkeys"><span class="kakeai-laptopspace"></span></span><span class="kakeai-laptoptrackpad"></span><span class="kakeai-laptopnotch"></span></div></div>';
}
