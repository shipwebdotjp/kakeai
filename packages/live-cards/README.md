# @kakeai/live-cards

Live Program の型付きカード（`headline` / `image` / `list` / `chart` / `quote`）を
描画する共有レンダラー。エディタのプレビューとライブステージで同じ実装を使う。
`@kakeai/video` には依存しない。

## 使い方

```ts
import { createLiveCardRenderer } from "@kakeai/live-cards";

const renderer = createLiveCardRenderer(host, {
  // エディタはアプリURL、ステージはパッケージ相対URLを返す。同期/非同期どちらも可。
  resolveAsset: (assetId) => `/assets/${assetId}`,
});

renderer.setCards(cards);
renderer.setVisual({ kind: "card", cardId, stateId });
renderer.markSettled(); // 初回スナップショット適用後に呼ぶ。以降の更新だけ animates。
```

- 初回マウント、`createLiveCardPreview`、`setConnected()` 後の再スナップショットは、
  アニメーションなしで完成状態を即時描画する。再接続後はスナップショットを適用して
  から `markSettled()` を呼ぶ。
- `visual: null` または `material` 参照ではカードを隠す。次にカードを表示したときは
  `enter` を再生する。
- 同じカードID・状態IDの再送は no-op。状態の中身を更新した場合は `setCards()` で
  定義を差し替える（現在表示中の状態はアニメーションなしで更新される）。
- `setVisual(..., { animate: false })` で個別にアニメーションを抑止できる。
- `prefers-reduced-motion: reduce` が有効な環境ではアニメーションを即時完了する。

## Shadow DOM とテーマ

ホスト要素に open Shadow DOM を作り、カードCSSをその中だけに注入する。ステージの
グローバルCSSはカードへ漏れない。テーマはホスト（またはその祖先）に設定された
CSSカスタムプロパティを通常の継承で受け取る。テーマパッケージへの依存はない。
1つのホストには1つのレンダラーだけをマウントする。再マウント時は以前のスロットと
スタイルのマーカーノードを置き換える。

主に参照する変数:

- `--kakeai-surface` / `--kakeai-surface-muted`
- `--kakeai-text` / `--kakeai-muted` / `--kakeai-border`
- `--kakeai-accent-primary` / `--kakeai-accent-secondary` / `--kakeai-accent-tertiary`
- `--kakeai-tone-success` / `--kakeai-tone-warning` / `--kakeai-tone-error` / `--kakeai-tone-info`
- `--kakeai-font-title` / `--kakeai-font-sans`
- `--kakeai-radius-lg` / `--kakeai-shadow`

未設定時はカード側のフォールバック色を使う。

## アニメーション

`animation.enter` / `animation.update` のプリセット、`durationMs`、`delayMs`、
`staggerMs` を解釈する。既定のアダプタは WAAPI を使い、利用できなければ Shadow
Root 内の CSS キーフレームにフォールバックする。グラフは `chartAnimation` の
`grow`（棒）と `draw`（折れ線）に対応する。

キー付き要素（リスト項目、グラフのカテゴリ・系列・凡例）が削除されると、
`update` プリセットを逆再生して退場し、完了後にDOMから外れる。新しい状態が
適用されると進行中の退場は即座に完了する。`animate: false` または
`prefers-reduced-motion: reduce` では即時削除する。

テストや監査では `createRecordingAnimationAdapter()` を `animationAdapter` に渡すと、
`run()` に届いたリクエストを同期的に記録できる。アダプタが例外を投げてもカードの
状態更新は止まらない。

## 画像

`image` カードは `resolveAsset(assetId)` でURLを解決する。解決失敗または `<img>` の
`error` では中央カード全体を隠し、例外は投げない。`onError` で警告を受け取れる。

## 編集用プレビュー

```ts
import { createLiveCardPreview } from "@kakeai/live-cards";

const preview = createLiveCardPreview(host, { resolveAsset });
preview.setCards(cards);
preview.setVisual(visual);
```

既定でアニメーションを無効にする以外は同じレンダラー。
