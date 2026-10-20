# Canvas Profile は CompositionVersion の不変プロパティとし、固定プロファイルで寸法を決める

`CompositionVersion` に **Canvas Profile** を持たせる。初期プロファイルは `landscape`（1920×1080）と `portrait`（1080×1920）の2つで、それぞれ固定寸法を持つ。Canvas Profile は publish 済み version ごとに固定されるため、1つの Composition が landscape と portrait の版を別々に公開でき、既存 ScriptVersion の参照を変えずに使い分けられる。最終レンダー出力は 1920×1080 固定のままとし、Canvas Profile は入れ子に配置される Composition 自身の内部キャンバスだけを定義する。

`composition.full-bleed@1` は landscape の version だけを受け付け、portrait は `scene.device-frame@1` の画面（9:16）に配置する。manifest の `canvasProfile` は任意とし、欠落時は landscape として解決する。既存 bundle と render snapshot はデータ移行せずそのまま landscape として読める。

## Considered Options

- 任意の `width` / `height` を許可する。→ 不正な寸法が保存され、検証・UI・レンダーの分岐が増えるため不採用。固定プロファイルにする。
- Canvas Profile を Composition 単位で持つ。→ 1つの Composition から landscape と portrait（スマホ向け抜粋など）を出したい要求に応えられないため不採用。version 単位にする。
- `composition.full-bleed@1` に portrait を許可し、レターボックスまたはクロップで置く。→ 全画面背景の意図（画面いっぱいに敷く）に反し、device-frame 経由の配置と役割が重複するため不採用。
- phone screen を物理端末比 9:19.5 のままにする。→ 標準の 9:16 に合わせる。保存済みの `@1` phone 参照が無いことを確認して変更する。

## Consequences

- `packages/contracts` に `canvasProfileSchema`・`CANVAS_PROFILE_DIMENSIONS`・`canvasProfileOf` を置き、`compositionManifestSchema` は任意の `canvasProfile` と、寸法がプロファイルと一致することを検証する。任意寸法と profile/寸法不一致は拒否する。
- Composition 作成と draft manifest API は `canvasProfile`（既定 `landscape`）を受け取り、seed HTML と manifest を選択した寸法で作る。publish は entry root の `data-width` / `data-height` が manifest のプロファイル寸法と一致することを検証する。
- 保存・draft preview・preview・render は `composition.full-bleed@1` の portrait 参照を拒否する。device-frame では両プロファイルを既存の fit / zoom / position 挙動のまま許可する。
- コンパイラの入れ子 slot スケーリングは解決済み manifest の寸法から導出する既存実装を維持し、phone 用の別レンダラーは追加しない。phone の CSS アスペクト比だけを 9:16 に変更し、laptop は維持する。
- UI は Composition Library と device-frame selector で公開 version に Canvas Profile を表示し、full-bleed selector は landscape の version だけを列挙する。
- 既存 bundle・snapshot は `canvasProfile` 欠落を landscape として解決し、データ移行しない。
