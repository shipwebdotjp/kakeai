# テンプレートの入力フィールド仕様と有限アニメーションpreset

VisualTemplate定義に `inputFields`（編集画面のフィールド仕様）と `animationPolicy`（許可preset・既定尺・最大尺）を追加し、編集画面を `inputFields` から生成する。入退場とテンプレート内部アニメーションは、有限preset（`none`/`fade`/`slide-up`/`slide-down`/`slide-left`/`slide-right`/`scale-in`、内部用に `pulse`）と尺だけで表す。`transitionPresetSchema` をこの集合へ広げる。

理由は、テンプレートを追加するたびに `form.ts` と `CueList.tsx` へテンプレート固有のフィールド実装を足す構造だと、背景・サイト枠・グラフなどのパターンを増やすほどコストが線形に増えるため。フィールド仕様をテンプレート定義へ集約し、エディタを汎用化することで追加コストを定数にする。アニメーションは有限presetに閉じ、任意CSS・keyframe・easing・スクリプトを正本へ持ち込まない [ADR-0031](./0031-cue-transition-and-animation-ownership.md) の原則を保つ。

## 構成

- `TemplateFieldSpec` は `media` / `nestedMedia` / `text` / `optionalText` / `select` / `color` / `animation` を持つ。`inputFields` を持つテンプレートは編集可能、持たないものは読み取り専用で非破壊に保持する。
- `AnimationPlan`（対象要素ID・preset・ローカル時刻・尺）をテンプレートrendererが返し、トップレベルコンパイラだけがGSAPタイムラインを生成する。
- `scene.device-frame@2` を追加し、任意の `animation` を画面要素へ適用する。`@1` は描画を変えない（[ADR-0009](./0009-template-version-immutability.md) に従い新版を追加）。

## Considered Options

- Zodスキーマを実行時に内省してフォームを自動生成する。→ ラベル・配置・素材種別などの提示情報が失われ、複雑な入力を扱いにくいため不採用。宣言的な `inputFields` を採用。
- テンプレート内部アニメーションを自由なkeyframeで表現する。→ 検証不能で正本が壊れるため不採用。
- `scene.device-frame@1` を書き換えて `animation` を足す。→ 版不変原則に反するため不採用（`@2` を追加）。

## Consequences

- `packages/contracts` に `content/animation.ts` を追加し、テンプレート定義のメタデータ（`inputFields`・`animationPolicy`）を唯一の情報源とする。
- 編集画面は `inputFields` を解釈してフォームを生成する。表・グラフなどリピータを要する入力は、必要になった時点で専用UIを追加する。
- 入退場presetの拡張は加算的で、保存済みの `fade`/`none` の解釈を変えない。
