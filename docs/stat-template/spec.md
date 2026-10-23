# 数値テンプレート（`stat@1`）仕様

## 目的と境界

この文書は、1つの大きな数値とラベルを強調表示する `stat@1` の正とする。Cue効果は [../cue-effects/spec.md](../cue-effects/spec.md)、数のカウント（count-up）は `value` 効果、決定は [ADR-0065](../adr/0065-count-up-value-effect.md) を参照する。

- 正本は自前の小さな構造化JSON（数値・ラベル・書式名・トーン名・効果）とする。HTML・SVG・スクリプトは正本にしない。
- 数値の整形は書式名（`integer` / `decimal` / `percent` / `currency`）で表し、実装の具体値はアプリ側に持つ。
- 動きは「Cue内の経過時間を渡すと状態が決まる」有限の仕組み（`AnimationPlan`・`stateIntervals`・`value` のカウント）で表し、任意のkeyframe・スクリプトを持ち込まない。プレビューのシークとMP4が一致する。

## 入力契約

`stat@1` の `visualCue.input` は次を満たす。

```jsonc
{
  "value": 1200,                       // 必須。数値
  "label": "導入社数",                  // 任意
  "caption": "2026年",                 // 任意
  "format": "integer",                 // integer | decimal | percent | currency（既定 integer）
  "style": {
    "tone": "primary",                 // primary | secondary | tertiary | success | warning | error | info
    "preset": "card"                   // plain | card（既定 plain）
  },
  "effects": [
    { "trigger": { "kind": "cue" }, "effect": { "kind": "value", "durationMs": 1000 } }
  ]
}
```

- `effects` の各要素は `{ trigger, effect }`。target は持たない（数値は1つ）。
- `effect` は `numericEffectSchema`（`appear` / `emphasize` / `value`）。
  - `value`: 数値を `from`（既定0）から `value` へ、Trigger区間（または `durationMs`）で数える。`from` が `value` より大きければカウントダウン、小さければカウントアップになる。
  - `emphasize`: 数値に枠・背景・スポットライトを当てる（区間中）。
  - `appear`: カード全体を登場させる。
- `format` は静的表示とカウント中の表示の両方に使う（`ja-JP` ロケール、`percent` は比率、`currency` はJPY・小数なし）。

## テンプレート定義

| 項目 | 値 |
| --- | --- |
| `id@version` | `stat@1` |
| `layers` | `card`, `overlay` |
| `transitionPolicy` | 既定（入退場はCue側） |
| `animationPolicy` | 既定 |
| `collectAssetRefs` | 素材を使わないため空 |
| `collectLineRefs` | `effects[].trigger` の行参照を収集する |

`inputFields` は次を持つ。

| key | kind | 内容 |
| --- | --- | --- |
| `value` | decimal | 数値（小数可）。カウント後の値 |
| `label` | optionalText | ラベル |
| `caption` | optionalText | 補足 |
| `format` | select | integer / decimal / percent / currency |
| `style.tone` | select | 7トーン |
| `style.preset` | select | plain / card |
| `effects` | effects | セリフ同期の効果（`variant: "stat"`、targetなし） |

新規Cueには、値 `100` と、Cue窓で数える既定効果（`value`, `durationMs: 1000`）を入れる。既定効果は `from` 0 から `value` 100 へカウントアップする。

## レンダリング

- 数値要素に `id` を付け、`value` 効果は `valueAnimations` として返す。コンパイラがプロキシオブジェクトを `fromTo` で更新し、`onUpdate` で数値要素のテキストを書式化して書き換える。`immediateRender` により発火前は `from`、区間中は補間、区間後は `value` を表示する。
- `emphasize` は数値要素に `stateIntervals`（`tl.set`）を当てる。`onset` は数値要素内の一時オーバーレイに当てる。
- `appear` はカード要素を `AnimationPlan` として登場させる。
- 決定性: 同じ入力・同じシーク位置で同じ表示になる。プレビューとMP4が一致する。

## 受け入れ条件

- 数値・ラベルを持つ `stat@1` を保存し、プレビューでシークし、MP4をレンダーできる。
- `value` 効果が、発火前は開始値、発火中はカウント、区間後は値で表示され、プレビューとMP4が一致する。
- `format` の4書式が静的表示とカウント中の表示で一致する。
- `emphasize`（`onset` 含む）と `appear` がプレビューとMP4で一致する。
- 同一テンプレートの複数配置で、要素ID・`valueAnimations`・`stateIntervals` が衝突しない。
- 未知の書式を保存時に拒否する。
