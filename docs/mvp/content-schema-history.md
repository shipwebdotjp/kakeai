# ContentDocument 破壊変更履歴

この文書は、`ScriptVersion.contentJson` の正本JSON契約（[content-schema.md](content-schema.md)）に対する破壊的変更の一覧を正とする。破壊的変更とは、既存の保存済みJSONが新しい契約をそのまま満たさなくなる変更を指す。破壊的変更を行うときは `schemaVersion` を上げ、この文書と読出し移行コード（`packages/contracts` の `migrateContentDocument`）、ADR を同じ変更で更新する。

`Job.inputSnapshotJson` の `snapshotSchemaVersion` は別系統の版管理であり、この文書の対象外とする。

## 一覧

| `schemaVersion` | 変更概要 | 関連ADR | 読出し時の移行 |
| --- | --- | --- | --- |
| 4 | Sceneスロット廃止とシーン間トランジション追加 | [0035](../adr/0035-remove-scene-slots-unify-text-cues.md)、[0036](../adr/0036-scene-transition-owned-by-entering-scene.md) | v3 以前の保存版は持たず、読み出し解釈を持たない |
| 5 | 必須の Scene Label 追加 | なし（[../scene-labels/spec.md](../scene-labels/spec.md)） | v4 の各Sceneへ従来表示名（`導入` / `要点 N` / `結び`）を補って v5 として解釈 |
| 6 | 必須の `visualTheme` と Scene の `accent` 追加 | [0040](../adr/0040-visual-theme-contract.md)（[../visual-themes/spec.md](../visual-themes/spec.md)） | v5 へ `visualTheme: soft-editorial@1` と全Sceneの `accent: { kind: "theme", token: "primary" }` を補って v6 として解釈 |
| 7 | キャラクター表情の台詞属性と Face Set 参照（`faceSetId` / `expressionId`）追加 | [0045](../adr/0045-face-set-global-reference.md)、[0047](../adr/0047-per-line-expression-id.md)（[../face-expression/spec.md](../face-expression/spec.md)） | v6 の各 Character Appearance へ `faceSetId: null` を、各 `NarrationSegment` へ `expressionId: null` を補って v7 として解釈 |
| 8 | `Character.voices`（locale別の声の対応）追加、`locale` の許容拡大 | [0052](../adr/0052-character-voices-per-locale.md)（[../multilingual-voice/spec.md](../multilingual-voice/spec.md)） | v7 の各 Character について、対応する話者の `voiceProfileId` があれば document の `locale` と組にして `voices` の1件とし、なければ `voices: []` として v8 として解釈 |

## 運用規則

- 保存済みJSONやそのハッシュを読み出し時に書き換えてはならない。次回の保存で新しい `ScriptVersion` を作る。
- `contentJson` はキー順を安定させたJSON文字列として保存する。JCS正規化や `contentHash` は持たない。
- 移行コードを先回りして持たない。版を上げる時点で `packages/contracts` に移行関数を追加する。
