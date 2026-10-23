# 複数立ち絵 仕様

## 目的と境界

この文書は、ロードマップ Phase 1「編集表現の拡張」のうち、複数立ち絵だけを先行して実装する範囲の正とする。台本の正本JSON契約は [../mvp/content-schema.md](../mvp/content-schema.md)、HTTP契約は [../mvp/api-contract.md](../mvp/api-contract.md) を正とする。決定の記録は [ADR 0027](../adr/0027-standing-side-and-speak-bounce.md) と [ADR 0028](../adr/0028-standing-edge-anchored-layout.md)。

- 1シーンに最大2体、左右に1体ずつ立ち絵を置ける。
- 左右は離散の `side`（`left` | `right`）で保持し、自由座標は編集しない。
- セリフを話している立ち絵だけが、そのセリフ区間でゆっくり上下にバウンドする。話者と対応しない立ち絵は静止する。
- シーン内での立ち絵切替、口パクは対象外。台詞ごとの表情切替は [../face-expression/spec.md](../face-expression/spec.md) で `character.standing@1` に統合し、編集UIは `@1` を書き出す。
- 契約は `character.standing@1`。Face Set を持つ外観の表情合成を含む（[ADR-0061](../adr/0061-template-version-as-reinterpretation-boundary.md) で `@2`/`@3` から `@1` へ再基準化）。

## データ

立ち絵1体は `character.standing@1` のVisualCueとして、`{ kind: "scene" }` の範囲で保存する。

```json
{
  "id": "visual-scene-point-1-standing-left",
  "template": { "id": "character.standing", "version": 1 },
  "range": { "kind": "scene" },
  "input": {
    "characterId": "character-rin",
    "appearanceId": "appearance-rin-smile",
    "side": "left",
    "scale": 1,
    "edge": "margin",
    "vertical": "standard"
  }
}
```

- `side` は `left` / `right`。位置はテンプレートが `side`・倍率・プリセットから正規化座標へ写像する。外端の余白は `edge` で3段階（`tight` 0、`margin` 2%・既定、`center` 8%）から選び、高さは `vertical` で3段階（`up` 0.78、`standard` 0.86・既定、`down` 0.92）から選ぶ。半幅 `0.15×scale`（基準幅576px / フレーム幅1920px）を用い、左 `x=margin+0.15×scale` / 右 `x=1−margin−0.15×scale` / `y=vertical` とする（外端の余白を一定に保つ）。
- `scale` は幅576px基準の倍率（従来の1が1.2に相当する新しい基準の1倍）。`edge` / `vertical` 省略時は既定値（`margin` / `standard`）で解釈する。
- 描画順は従来どおり背景、カード、立ち絵、Scene本文・字幕。複数の立ち絵は同じ立ち絵レイヤーに置く。
- ContentDocument は複数Cueと任意 `side` を検証・保持する。UI範囲外のCueは保存時に削除・変更しない。

## 発話中のバウンド

- 立ち絵の `characterId` に対応する話者（`Speaker.characterId`）を求める。
- Scene内で、その話者が担当するセリフ区間（`NarrationSegment` の開始〜終了）だけをバウンド区間とする。連続する区間はまとめる。
- 区間中は `y` を上方向へ動かして戻す往復（yoyo）を繰り返す。振幅・周期・イージングは描画側の規約で、正本JSONには保存しない。
- 話者が紐づかないセリフ（`speakerId` が null）、および話していない立ち絵は静止する。

## 編集UI

- 各Sceneに「左（上）」「右（下）」の2枠を固定順で常に表示し、各枠でキャラクター、外観、倍率、端からの位置（ギリギリ / 少し余白あり / 中央より）、高さ（上 / 標準 / 下）を選ぶ。
- 各枠で入場・退場（preset と尺）を設定できる。preset は `transitionPolicy` の全候補、尺は最大 `1000ms`。既定は入場・退場とも `none`（尺0）。
- 枠の追加・削除は行わない。位置は `edge` / `vertical` の3段階から選ぶ。キャラクターを「未指定」に戻すと、その枠の立ち絵を解除する。
- キャラクターを選択した枠だけ外観と倍率を表示する。キャラクターが1体も無いときも2枠を表示し、追加を促す。
- キャラクター削除・外観削除時は、該当の立ち絵選択を解除する。
