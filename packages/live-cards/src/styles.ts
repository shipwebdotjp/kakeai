/**
 * Card CSS lives inside the renderer's shadow root. Theme variables are read
 * from the host (`--kakeai-*`), so a theme stylesheet on an ancestor of the
 * host crosses the shadow boundary by normal CSS custom-property inheritance.
 */
export const LIVE_CARD_CSS = `
:host {
  display: block;
  width: 100%;
  height: 100%;
  color: var(--kakeai-text, #2b2620);
  font-family: var(--kakeai-font-sans, system-ui, sans-serif);
}

.kc-slot {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  container-type: inline-size;
}

[hidden] {
  display: none !important;
}

.kc-card {
  box-sizing: border-box;
  width: min(100%, 1500px);
  max-height: 100%;
  color: var(--kakeai-text, #2b2620);
  font-family: var(--kakeai-font-sans, system-ui, sans-serif);
  font-size: clamp(16px, 1.8cqw, 30px);
  line-height: 1.45;
  --kc-surface: var(--kakeai-surface, #fffdf8);
  --kc-surface-muted: var(--kakeai-surface-muted, #f2ecdf);
  --kc-text: var(--kakeai-text, #2b2620);
  --kc-muted: var(--kakeai-muted, #6f665b);
  --kc-border: var(--kakeai-border, #d9d0c2);
  --kc-radius: var(--kakeai-radius-lg, 28px);
  --kc-font-title: var(--kakeai-font-title, var(--kakeai-font-sans, system-ui, sans-serif));
  --kc-shadow: var(--kakeai-shadow, rgba(38, 33, 28, 0.18));
}

.kc-card:not([data-tone]) {
  --kc-tone: var(--kakeai-accent-primary, #c4552d);
}

[data-tone="primary"] {
  --kc-tone: var(--kakeai-accent-primary, #c4552d);
}

[data-tone="secondary"] {
  --kc-tone: var(--kakeai-accent-secondary, #2f6f6a);
}

[data-tone="tertiary"] {
  --kc-tone: var(--kakeai-accent-tertiary, #80600f);
}

[data-tone="success"] {
  --kc-tone: var(--kakeai-tone-success, #2f7d4f);
}

[data-tone="warning"] {
  --kc-tone: var(--kakeai-tone-warning, #9a6a00);
}

[data-tone="error"] {
  --kc-tone: var(--kakeai-tone-error, #b3261e);
}

[data-tone="info"] {
  --kc-tone: var(--kakeai-tone-info, #1f5f8b);
}

.kc-card[data-align="center"] {
  text-align: center;
}

.kc-card[data-align="left"] {
  text-align: left;
}

.kc-surface,
.kc-headline,
.kc-list,
.kc-chart,
.kc-quote {
  background: var(--kc-surface);
  border: 1px solid var(--kc-border);
  border-radius: var(--kc-radius);
  box-shadow: 0 16px 50px var(--kc-shadow);
}

/* Headline */

.kc-headline {
  box-sizing: border-box;
  padding: clamp(26px, 4cqw, 72px);
  border-left: clamp(8px, 1cqw, 16px) solid var(--kc-tone);
}

.kc-kicker {
  margin: 0 0 0.6em;
  color: var(--kc-tone);
  font-size: clamp(13px, 1.2cqw, 22px);
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.kc-title {
  margin: 0;
  color: var(--kc-text);
  font-family: var(--kc-font-title);
  font-size: clamp(30px, 5.8cqw, 92px);
  font-weight: 700;
  line-height: 1.2;
  overflow-wrap: anywhere;
}

.kc-subtitle {
  margin: 0.5em 0 0;
  color: var(--kc-muted);
  font-size: clamp(16px, 2cqw, 34px);
  line-height: 1.5;
}

/* Image */

.kc-image {
  box-sizing: border-box;
  margin: 0;
  padding: clamp(12px, 1.6cqw, 24px);
  background: var(--kc-surface);
  border: 1px solid var(--kc-border);
  border-radius: var(--kc-radius);
  box-shadow: 0 16px 50px var(--kc-shadow);
}

.kc-image-frame {
  width: 100%;
  height: clamp(180px, 36cqw, 620px);
  overflow: hidden;
  border-radius: calc(var(--kc-radius) * 0.7);
  background: var(--kc-surface-muted);
}

.kc-image-img {
  display: block;
  width: 100%;
  height: 100%;
}

.kc-card[data-fit="cover"] .kc-image-img {
  object-fit: cover;
}

.kc-card[data-fit="contain"] .kc-image-img {
  object-fit: contain;
}

.kc-image-meta {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.5em 1em;
  padding: 0.7em 0.2em 0.1em;
  color: var(--kc-muted);
}

.kc-image-caption {
  color: var(--kc-text);
  font-size: clamp(14px, 1.4cqw, 24px);
}

.kc-image-credit {
  margin-left: auto;
  font-size: clamp(11px, 1cqw, 18px);
  opacity: 0.8;
}

/* List */

.kc-list {
  box-sizing: border-box;
  padding: clamp(24px, 3.4cqw, 60px);
}

.kc-list-title {
  margin: 0 0 0.8em;
  color: var(--kc-text);
  font-family: var(--kc-font-title);
  font-size: clamp(24px, 3.2cqw, 54px);
  font-weight: 700;
  line-height: 1.25;
}

.kc-list-items {
  display: flex;
  flex-direction: column;
  gap: clamp(10px, 1.4cqw, 22px);
  margin: 0;
  padding: 0;
}

.kc-list-item {
  display: flex;
  align-items: flex-start;
  gap: clamp(10px, 1.2cqw, 20px);
  padding: clamp(8px, 1.1cqw, 18px) clamp(12px, 1.4cqw, 22px);
  border: 1px solid transparent;
  border-radius: calc(var(--kc-radius) * 0.6);
}

.kc-list-item[data-active="true"] {
  background: var(--kc-surface-muted);
  border-color: var(--kc-tone);
}

.kc-list-marker {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 1.7em;
  height: 1.7em;
  border-radius: 999px;
  background: var(--kc-surface-muted);
  color: var(--kc-muted);
  font-size: 0.9em;
  font-weight: 700;
}

.kc-list-item[data-active="true"] .kc-list-marker {
  background: var(--kc-tone);
  color: var(--kc-surface);
}

.kc-list-copy {
  display: flex;
  flex-direction: column;
  gap: 0.2em;
  min-width: 0;
}

.kc-list-text {
  color: var(--kc-text);
  font-size: clamp(17px, 2.1cqw, 36px);
  font-weight: 600;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.kc-list-note {
  color: var(--kc-muted);
  font-size: clamp(12px, 1.25cqw, 21px);
  line-height: 1.4;
}

/* Chart */

.kc-chart {
  box-sizing: border-box;
  padding: clamp(24px, 3.2cqw, 54px);
}

.kc-chart-title {
  margin: 0 0 0.7em;
  color: var(--kc-text);
  font-family: var(--kc-font-title);
  font-size: clamp(22px, 2.9cqw, 50px);
  font-weight: 700;
  line-height: 1.25;
}

.kc-chart-body {
  display: flex;
  flex-direction: column;
  gap: clamp(10px, 1.4cqw, 22px);
}

.kc-chart-groups {
  display: flex;
  align-items: flex-end;
  gap: clamp(8px, 1.4cqw, 24px);
  height: clamp(180px, 30cqw, 440px);
  padding-top: 1.8em;
}

.kc-chart-group {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  gap: 0.5em;
  min-width: 0;
  height: 100%;
}

.kc-chart-plot-group {
  position: relative;
  flex: 1 1 auto;
  width: 100%;
}

.kc-chart-bar {
  position: absolute;
  min-height: 2px;
  border-radius: 6px 6px 2px 2px;
  background: var(--kc-tone, var(--kakeai-accent-primary, #c4552d));
  transform-origin: bottom center;
}

.kc-chart-bar[data-negative="true"] {
  border-radius: 2px 2px 6px 6px;
  transform-origin: top center;
}

.kc-chart-bar-value {
  position: absolute;
  top: -1.45em;
  left: 50%;
  color: var(--kc-muted);
  font-size: 0.68em;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  transform: translateX(-50%);
}

.kc-chart-bar[data-negative="true"] .kc-chart-bar-value {
  top: auto;
  bottom: -1.45em;
}

.kc-chart-category,
.kc-chart-axis-label {
  overflow: hidden;
  color: var(--kc-muted);
  font-size: clamp(11px, 1.1cqw, 19px);
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kc-chart[data-has-highlight="true"] .kc-chart-group[data-highlight="false"] {
  opacity: 0.45;
}

.kc-chart[data-has-highlight="true"] .kc-chart-bar[data-series-highlight="false"] {
  opacity: 0.45;
}

.kc-chart-legend {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.5em 1.4em;
}

.kc-chart-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 0.45em;
  color: var(--kc-muted);
  font-size: clamp(12px, 1.15cqw, 20px);
}

.kc-chart-legend-item[data-highlight="false"] {
  opacity: 0.45;
}

.kc-chart-swatch {
  width: 0.9em;
  height: 0.9em;
  border-radius: 0.2em;
  background: var(--kc-tone, var(--kakeai-accent-primary, #c4552d));
}

.kc-chart-unit {
  margin: 0;
  color: var(--kc-muted);
  font-size: clamp(11px, 1.05cqw, 18px);
  text-align: right;
}

.kc-chart-line-svg {
  display: block;
  width: 100%;
  height: clamp(200px, 32cqw, 470px);
  overflow: visible;
}

.kc-chart-line-path {
  fill: none;
  stroke: var(--kc-tone, var(--kakeai-accent-primary, #c4552d));
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2.4;
  vector-effect: non-scaling-stroke;
}

.kc-chart-line-path[data-highlight="false"] {
  opacity: 0.4;
}

.kc-chart-point {
  fill: var(--kc-tone, var(--kakeai-accent-primary, #c4552d));
  stroke: var(--kc-surface);
  stroke-width: 0.6;
}

.kc-chart-point[data-highlight="false"] {
  opacity: 0.4;
}

.kc-chart-axis {
  display: flex;
  gap: clamp(8px, 1.4cqw, 24px);
}

.kc-chart-axis-label {
  flex: 1 1 0;
  min-width: 0;
}

.kc-chart-axis-label[data-highlight="false"] {
  opacity: 0.45;
}

/* Quote */

.kc-quote {
  position: relative;
  box-sizing: border-box;
  margin: 0;
  padding: clamp(30px, 4.4cqw, 80px);
  border-top: clamp(6px, 0.8cqw, 12px) solid var(--kc-tone);
}

.kc-quote::before {
  content: "\\201C";
  position: absolute;
  top: 0.05em;
  left: 0.18em;
  color: var(--kc-tone);
  font-family: var(--kc-font-title);
  font-size: clamp(70px, 12cqw, 190px);
  line-height: 1;
  opacity: 0.16;
  pointer-events: none;
}

.kc-quote-text {
  position: relative;
  margin: 0;
  color: var(--kc-text);
  font-family: var(--kc-font-title);
  font-size: clamp(24px, 3.4cqw, 58px);
  font-weight: 600;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.kc-quote-meta {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.4em 1em;
  margin-top: 1em;
  color: var(--kc-muted);
  font-size: clamp(13px, 1.3cqw, 22px);
}

.kc-quote-author {
  color: var(--kc-text);
  font-style: normal;
  font-weight: 700;
}

/* Animation fallbacks (WAAPI is preferred by the default adapter). */

.kc-anim-fade {
  animation: kc-fade var(--kc-anim-duration, 400ms) cubic-bezier(0.2, 0.8, 0.2, 1)
    var(--kc-anim-delay, 0ms) both;
}

.kc-anim-slide-up {
  animation: kc-slide-up var(--kc-anim-duration, 400ms) cubic-bezier(0.2, 0.8, 0.2, 1)
    var(--kc-anim-delay, 0ms) both;
}

.kc-anim-slide-down {
  animation: kc-slide-down var(--kc-anim-duration, 400ms) cubic-bezier(0.2, 0.8, 0.2, 1)
    var(--kc-anim-delay, 0ms) both;
}

.kc-anim-slide-left {
  animation: kc-slide-left var(--kc-anim-duration, 400ms) cubic-bezier(0.2, 0.8, 0.2, 1)
    var(--kc-anim-delay, 0ms) both;
}

.kc-anim-slide-right {
  animation: kc-slide-right var(--kc-anim-duration, 400ms) cubic-bezier(0.2, 0.8, 0.2, 1)
    var(--kc-anim-delay, 0ms) both;
}

.kc-anim-scale-in {
  animation: kc-scale-in var(--kc-anim-duration, 400ms) cubic-bezier(0.2, 0.8, 0.2, 1)
    var(--kc-anim-delay, 0ms) both;
}

.kc-chart-anim-grow {
  animation: kc-grow var(--kc-anim-duration, 400ms) cubic-bezier(0.2, 0.8, 0.2, 1)
    var(--kc-anim-delay, 0ms) both;
}

.kc-chart-anim-draw {
  animation: kc-draw var(--kc-anim-duration, 400ms) cubic-bezier(0.2, 0.8, 0.2, 1)
    var(--kc-anim-delay, 0ms) both;
}

@keyframes kc-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes kc-slide-up {
  from { opacity: 0; transform: translateY(28px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes kc-slide-down {
  from { opacity: 0; transform: translateY(-28px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes kc-slide-left {
  from { opacity: 0; transform: translateX(28px); }
  to { opacity: 1; transform: translateX(0); }
}

@keyframes kc-slide-right {
  from { opacity: 0; transform: translateX(-28px); }
  to { opacity: 1; transform: translateX(0); }
}

@keyframes kc-scale-in {
  from { opacity: 0; transform: scale(0.94); }
  to { opacity: 1; transform: scale(1); }
}

@keyframes kc-grow {
  from { transform: scaleY(0); }
  to { transform: scaleY(1); }
}

@keyframes kc-draw {
  from { stroke-dasharray: 1 1; stroke-dashoffset: 1; }
  to { stroke-dasharray: 1 1; stroke-dashoffset: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .kc-card,
  .kc-card * {
    animation-duration: 1ms !important;
    animation-delay: 0ms !important;
    transition: none !important;
  }
}
`;
