# 台詞ごとの表情は NarrationSegment.expressionId で持つ

表情は、台詞の発話区間だけ適用する。そのために `NarrationSegment` に任意の `expressionId`（`string | null`）を追加し、`CharacterAppearance` に任意の `faceSetId`（`string | null`）を追加する。これに伴い `ContentDocument` を `schemaVersion: 7` とする。

- `expressionId` は、話者（`Speaker.characterId`）に対応するキャラクターの、そのSceneで有効な Character Appearance が参照する Face Set 内で一意な Expression Preset を指す。
- `speakerId` が `null` のラインは `expressionId` を `null` に限る。話者のないナレーションには表情を付けない。
- `expressionId` が `null`、または既存台詞で未指定の場合は `normal` として解釈する。
- 直前の台詞から表情を暗黙に引き継がない。

## schemaVersion 移行

読み出し時、v6 の各 `appearances[]` へ `faceSetId: null` を、各 `lines[]` へ `expressionId: null` を補って v7 として解釈する。保存済みJSONは書き換えず、次回の保存で新しい v7 `ScriptVersion` を作る。既存の v4 → v5 → v6 の読出し移行は維持する。

## Considered Options

- 表情を `VisualCue`（`range: lines`）として表現する。→ `(scene, layer, order)` 一意制約、同一Scene内の複数表情区間、AI・UIの編集単位の観点で冗長になりやすいため不採用。
- 表情を `CharacterAppearance` に焼き込み、外観を切り替える。→ 表情のたびに立ち絵素材とシーンを増やす必要があり、本機能の目的に反するため不採用。
- `line` ではなく `Standing` Cue 側に表情タイムラインを持たせる。→ 話者と台詞の対応から導ける情報を二重管理することになり、編集単位が分かりにくいため不採用。

## Consequences

- `packages/contracts` の `characterAppearanceSchema` と `narrationSegmentSchema` を拡張し、`expressionId` の存在（話者なしでは不可）を検証する。
- 表情 ID の実在（Face Set 内）は、グローバル参照のため `contentJson` のスキーマでは検証できない。API サービスが保存時に解決して検証する（[ADR-0045](./0045-face-set-global-reference.md)）。
- 既存の `expression` / `pose` 文字列タグは表示名の補助として残し、`expressionId` とは別物として扱う。
