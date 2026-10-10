# 複合ビジュアル（VisualCue v3・Composite Visual Template）仕様

## 目的と境界

この文書は、ロードマップ Phase 1「編集表現の拡張」のうち、Sceneの背景・カードなどに画像・動画だけでなく**アプリ管理の複合ビジュアル（Composite Visual Template）**を置けるようにする基盤の正とする。台本の契約は [../mvp/content-schema.md](../mvp/content-schema.md)、HTTP契約は [../mvp/api-contract.md](../mvp/api-contract.md)、決定は [ADR 0029](../adr/0029-content-document-v3-visual-cue.md)・[ADR 0030](../adr/0030-composite-visual-template-isolation.md)・[ADR 0031](../adr/0031-cue-transition-and-animation-ownership.md) を参照する。

- 「Composition」はアプリが管理する信頼済み `VisualTemplate` の合成を意味する。利用者・外部AIが生成した任意の HyperFrames/HTML/JavaScript を Work に保存・実行しない。HyperFrames の外部HTMLサブComposition読込は使わない。
- AIの将来入力も、信頼済みテンプレートの入力Zodスキーマに適合するパラメータJSONだけを受け入れる。
- 保存済み `ScriptVersion` が存在しない前提で ContentDocument を `schemaVersion: 3` へ切り替える。v1/v2 の読出し・移行コードは持たない。着手前に保存済み版が無いことを確認し、存在した場合は本基盤ではなく移行計画へ戻す。

## VisualCue v3

`VisualCue` は次を必須とする。

```jsonc
{
  "id": "...",
  "range": { "kind": "scene" } | { "kind": "lines", "startLineId", "endLineId" } | { "kind": "offset", "startMs", "endMs" },
  "layer": "background" | "card" | "standing" | "overlay",
  "order": 0,
  "transition": {
    "enter": { "preset": "none" | "fade" | "slide-up" | "slide-down" | "slide-left" | "slide-right" | "scale-in", "durationMs": 0 },
    "exit":  { "preset": "none" | "fade" | "slide-up" | "slide-down" | "slide-left" | "slide-right" | "scale-in", "durationMs": 0 }
  },
  "template": { "id": "...", "version": 1 },
  "input": {}
}
```

- `(scene, layer, order)` は一意。配列順を描画順の根拠にしない。
- 描画順は契約で固定する: `background → card → standing → Scene本文 → caption → overlay`。`Scene本文`・`caption` はコンパイラ固定層でCue対象外。Cueが取れる `layer` は `background | card | standing | overlay`。
- `range` は解決後、半開区間 `[start, end)` として扱う。`enter` は先頭から、`exit` は末尾へ向けて適用し、範囲外へはみ出させない。
- `enter.durationMs + exit.durationMs <= Cue範囲` を保存時とレンダー投入時に共通タイムライン解決器で検証する。
- `preset: "none"` は `durationMs: 0` を要求する。

## transitionPolicy とアニメーションの責務分離

| 対象 | 責務 |
| --- | --- |
| VisualCue | 表示範囲、レイヤー、同層順、入場・退場 |
| Composite Visual Template | 内部レイアウトと、入力スキーマで許可した内部アニメーション |
| NestedVisual | 親テンプレート内に描画される子。独自の range・layer・transition を持たない |

- テンプレート定義は `transitionPolicy` を持ち、許可preset・既定値・最大尺を定める。既定値はCue作成時に明示値として書き込み、レンダー時に暗黙導出しない。
- テンプレート固有の動きは入力スキーマ内の有限presetと数値だけで表す。汎用keyframe、任意CSS値、任意easing、スクリプト文字列は追加しない。

## NestedVisual と再帰

```jsonc
NestedVisual =
  | { "kind": "media", "assetId": "...", "fit"?: "cover" | "contain", "focalPoint"?: { "x": 0.5, "y": 0.5 } }
  | { "kind": "template", "template": { "id": "...", "version": 1 }, "input": {} }
```

- 再帰はテンプレートの `input` 内だけに閉じる。
- 深さ8・総ノード数64を上限とする。子Visualのテンプレート存在・入力・素材参照はDocumentの再帰walkerで検証する。
- 素材参照の走査はテンプレート定義の `collectAssetRefs` に集約する。`assetBearingTemplateKeys` やテンプレートID決め打ちの並べ替えを持たない。

## レンダリングと分離

- 各テンプレート renderer は HTML断片、素材参照、ローカル時刻の AnimationPlan だけを返す。GSAPタイムラインと Composition HTML の生成はトップレベルコンパイラだけが行う。
- Cue ID を可逆なDOM-safe文字列へ符号化した scope を作り、子Visualには構造パス由来のsuffixを付ける。DOM ID、`getElementById`、CSSセレクタ、AnimationPlanのtargetはすべて scope 配下だけを参照する。
- テンプレートは `<script>`・グローバルID・グローバルquery selector を返さない。複数Cue・入れ子・同一テンプレート重複配置で衝突しないことをコンパイラテストで確認する。

## テンプレート

| VisualTemplate | layer | 入力 | 状態 |
| --- | --- | --- | --- |
| `text.title@1` | overlay | title, subtitle, anchor? | 対応（inputFieldsで編集） |
| `text.body@1` | overlay | heading, body | 対応（inputFieldsで編集） |
| `media.full-bleed@1` | background | assetId, fit, focalPoint? | 対応 |
| `media.card@1` | card | assetId, heading, caption?, focalPoint? | 対応 |
| `character.standing@1` | standing | characterId, appearanceId, x, y, scale | 読出しのみ |
| `character.standing@2` | standing | characterId, appearanceId, side, scale | 対応（左右1体ずつ最大2体） |
| `scene.device-frame@1` | background, card | screen(NestedVisual), frame(laptop/phone), backgroundColor? | 対応（複合ビジュアル） |
| `scene.device-frame@2` | background, card | `@1` ＋ animation? | 対応（画面の登場アニメーション） |

## テンプレート入力メタデータと汎用エディタ

テンプレート定義は `inputFields`（UIフィールド仕様）を持ち、編集画面はこれを解釈してフォームを生成する。テンプレートを追加してもエディタのコードを増やさない。

```ts
type TemplateFieldSpec =
  | { kind: "media"; key; label; assetKinds }        // トップレベルの assetId
  | { kind: "nestedMedia"; key; label; assetKinds }  // NestedVisual を media として編集
  | { kind: "text"; key; label }
  | { kind: "optionalText"; key; label }             // 空なら key を削除
  | { kind: "select"; key; label; options }
  | { kind: "color"; key; label }                    // #RRGGBB を検証
  | { kind: "animation"; key; label }                // preset と durationMs
```

- `inputFields` を持つテンプレートは編集可能、持たないテンプレートは読み取り専用で非破壊に保持する。
- `nestedMedia` は、既存の `input` が `media` 以外（入れ子テンプレート）の場合は元の値を保持し、`media` のときだけ素材の解除でCueを消す。
- `collectAssetRefs` はテンプレート定義に集約し、`inputFields` とは独立して素材参照を走査する。

## アニメーションpreset

入場・退場とテンプレート内部アニメーションは、有限presetと数値だけで表す。汎用keyframe・任意CSS値・任意easing・スクリプト文字列は追加しない。

- preset: `none` / `fade` / `slide-up` / `slide-down` / `slide-left` / `slide-right` / `scale-in`（入退場）、加えて内部用に `pulse`。
- 入退場は `transitionPolicy`（許可preset・既定値・最大尺）に照合し、`enter + exit <= Cue範囲` を共通タイムライン解決器で検証する。
- テンプレート内部アニメーションは `animationPolicy`（許可preset・既定尺・最大尺）に照合し、テンプレート入力を経由して `AnimationPlan`（対象要素ID・preset・ローカル時刻・尺）としてコンパイラへ渡す。コンパイラだけがGSAPタイムラインを生成する。
- `scene.device-frame@2` は任意の `animation` を画面要素に適用する。`@1` はアニメーションを持たず、描画を変えない。

## 編集UI

- 各Sceneに **Cue一覧** を表示し、追加・削除・レイヤー・順序・表示区間・入場/退場を編集する。
- テンプレート固有の入力は `inputFields` から生成する。素材はピッカーで画像・動画を選び、色・選択・数値・テキスト・アニメーションを編集する。
- 「Cueを追加」は編集可能なテンプレート（背景・カード・デバイスフレーム・タイトル・本文）の最新版を提示する。
- 立ち絵は一覧内に「左」「右」の固定2行として表示し、side一意・最大2の制約を保つ。
- UI未対応のテンプレート・Cueは読み取り専用で非破壊に保持する。

## 受け入れ条件

- device-frame内の画像と動画を、背景・カードの両レイヤーで保存し、プレビューでシークし、MP4をレンダーできる。
- `layer`/`order` 欠損・重複、許可外transition、Cue範囲に収まらないtransitionを拒否する。
- 再帰入力の深さ・ノード数上限と、ネスト素材の存在・ready・種別を検証する。
- 同一テンプレートを複数Cue・複数階層に置いてもID・CSS・AnimationPlanが衝突しない。
