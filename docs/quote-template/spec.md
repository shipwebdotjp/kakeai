# 引用テンプレート（`quote@1`）仕様

## 目的と境界

この文書は、著者・出典付きの引用カードを表示する `quote@1` の正とする。Cue効果は [../cue-effects/spec.md](../cue-effects/spec.md)、台本の契約は [../mvp/content-schema.md](../mvp/content-schema.md)、決定は [ADR-0062](../adr/0062-line-triggered-effect-unit.md)・[ADR-0063](../adr/0063-animation-onset-and-sustained-state.md) を参照する。

- 正本は自前の小さな構造化JSON（引用本文・著者・出典・トーン名・スタイル名・効果）とする。HTML・SVG・スクリプトは正本にしない。
- 引用本文は常時表示し、セリフ区間を契機に強調する。セリフ行の実時刻は選択済みAudioTakeの尺から派生し、入力にミリ秒を直書きせず行IDを参照して共通解決器で解決する。
- 動きは `appear`（一発で現れる）と `emphasize`（区間中ずっと強調する）だけで表す。任意のkeyframe・CSS・easing文字列・スクリプトは持ち込まない。プレビューのシークとMP4が一致する。
- 数値のカウント（`value`）は持たない（引用はテキストのため）。

## 入力契約

`quote@1` の `visualCue.input` は次を満たす。

```jsonc
{
  "quote": "テンプレートは再利用の契約である",   // 必須。引用本文
  "author": "山田太郎",                        // 任意。著者
  "source": "設計資料 第3版",                   // 任意。出典
  "style": {
    "tone": "primary",                         // primary | secondary | tertiary | success | warning | error | info（既定 primary）
    "preset": "card"                           // plain | card（既定 plain）
  },
  "effects": [
    {
      "trigger": { "kind": "lines", "startLineId": "line-1", "endLineId": "line-1" },
      "effect": { "kind": "emphasize", "style": "spotlight", "tone": "primary", "onset": { "preset": "sweep", "durationMs": 600 } }
    }
  ]
}
```

- `quote` は必須。空文字も許容するが、内容は利用者が入力する。
- `author`・`source` は任意。両方空のときは帰属表示（`figcaption`）を描画しない。
- `effects` の各要素は `{ trigger, effect }`。target は持たない（引用は1つ）。
  - `effect` は `cueEffectSchema`（`appear` / `emphasize`）。
  - `emphasize`: 引用本文に枠・背景・スポットライトを当てる（区間中）。`spotlight` では著者・出典を減光する。`onset` は引用本文内の一時オーバーレイに当たる。
  - `appear`: カード全体を登場させる。
- 強調の対象は引用本文のみ。`background` は引用本文の背景色と文字色を変える（カード全体は変えない）。

## テンプレート定義

| 項目 | 値 |
| --- | --- |
| `id@version` | `quote@1` |
| `layers` | `overlay` |
| `transitionPolicy` | 既定（入退場はCue側） |
| `animationPolicy` | 既定 |
| `collectAssetRefs` | 素材を使わないため空 |
| `collectLineRefs` | `effects[].trigger` の行参照を収集する |

`inputFields` は次を持つ。

| key | kind | 内容 |
| --- | --- | --- |
| `quote` | text | 引用本文 |
| `author` | optionalText | 著者 |
| `source` | optionalText | 出典 |
| `style.tone` | select | 7トーン |
| `style.preset` | select | plain / card |
| `effects` | effects | セリフ同期の効果（`variant: "quote"`、targetなし） |

新規Cueには、引用本文 `""` と、Cue窓でカードをフェード登場させる既定効果（`appear`, `durationMs: 400`）を入れる。

## レンダリング

- `figure.kakeai-quotewrap` > `div.kakeai-quotecard`（`preset: card` のとき背景と影を付ける）> `blockquote.kakeai-quotetext` + `figcaption.kakeai-quoteattrib`（著者・出典）を描く。
- 引用本文要素に `id` を付ける。`emphasize` は引用本文に `stateIntervals`（`tl.set`）を当て、`spotlight` では著者・出典要素に減光の `stateIntervals` を当てる。`onset` は引用本文内の一時オーバーレイに当てる（発火と持続は別要素・別プロパティ）。
- `appear` はカード要素を `AnimationPlan` として登場させる。
- 要素IDはCue scope 配下に閉じ、複数配置・入れ子で衝突しない。
- 決定性: 同じ入力・同じシーク位置で同じ表示になる。プレビューとMP4が一致する。

## 非ゴール

- 複数の引用を1つのCueに並べる（1 Cue = 1引用。複数はCueを分ける）。
- 引用本文の一部だけを行トリガーで指す（強調は引用本文の単位）。
- 数値カウント（`value`）。引用はテキストのため対象外。
- 話者・発話との自動紐づけ（Triggerは利用者が行区間を選ぶ）。

## 受け入れ条件

- 引用・著者・出典を持つ `quote@1` を保存し、プレビューでシークし、MP4をレンダーできる。
- `author`・`source` を両方空にすると帰属表示が出ず、どちらか一方だけでも正しく表示される。
- 行トリガーの `appear` / `emphasize` / `spotlight` / `onset` が、プレビューのシークとMP4で一致し、区間末で解除される。
- `spotlight` で引用本文がリング表示され、著者・出典が減光されて区間末で戻る。
- 行の並べ替え・削除・分割後も、Trigger参照が同じ行を指し続ける。
- 同一テンプレートの複数配置・入れ子で、要素ID・`AnimationPlan`・`stateIntervals` が衝突しない。
- 引用本文を欠く入力を保存時に拒否する。
