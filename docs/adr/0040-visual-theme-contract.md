# Visual Theme 契約（`soft-editorial@1`）

Superseded by [ADR 0049](./0049-custom-visual-theme-revisions.md).

Visual Theme はVisualTemplateの見た目の**既定値**を提供する。Cueの明示設定は常に優先し、既存テンプレートの入力契約と柔軟性を変えない。初回は `soft-editorial@1` を唯一の組み込みテーマとし、Document・プレビュー・レンダー・既存VisualTemplateへ接続する。

- **Document固定**: ContentDocument は直下の必須 `visualTheme: { id, version }` でテーマを固定する。Render Jobのスナップショットは固定済みDocumentごと保存し、ワーカーは実行時の信頼済みコンパイラとテーマ定義で描画する（[ADR-0011](./0011-render-snapshot-recompile.md) と同じ扱い）。テーマ切替UI・二つ目のテーマは持たない。
- **信頼済みカタログ**: テーマ定義はアプリ管理の版付きレジストリ（`packages/contracts`）だけとし、利用者や外部入力でテーマ本体を持ち込めない。未知の `visualTheme` 参照はDocument検証で拒否し、コンパイラも `unknown_theme` で失敗する。`template.id@version` と同じ不変規律を適用し、変更は新版で行う。
- **Cue上書き可能な既定値**: `text.block` はプロパティ単位で `Cueの明示値 → themeのrole別既定値 → templateの最終fallback` の順に解決する。roleの意味分類は増やさない。Sceneアクセントは `{ kind: "theme", token }`（3色のいずれか）または `{ kind: "custom", color }` のunionとし、旧 `accentColor`（`#RRGGBB`）は `schemaVersion: 6` で置換する。v5→v6 の読出し移行は全Sceneを `theme.primary` へ統一し、Text Cueの明示スタイルは保持する。
- **分離**: Web UIのライト／ダーク、および `scene.site-mockup@1` の `theme`（`light`/`dark`）はVisual Themeと別概念のままにする。サイト固有アクセントは維持し、テーマは汎用surface・文字・影だけへ適用する。

理由は、配色・書体・余白の既定値を正本（Document）に固定すれば、プレビューとMP4の見た目が版ごとに再現でき、将来のテーマ追加・画像生成アートディレクションも同じ参照で追跡できるため。Cue明示値を最優先にすることで、既存作品の意図的な上書きを移行で壊さない。

## Considered Options

- テーマをDocumentに持たずアプリ設定にする。→ 版ごとの見た目再現が崩れ、正本と派生の分離（[ADR-0001](./0001-canonical-json-over-derived-media.md)）に反するため不採用。
- テーマ定義を利用者編集可能にする。→ 任意コード・CSSの持込み禁止（[ADR-0031](./0031-cue-transition-and-animation-ownership.md)）と衝突し、検証・再現のコストが増えるため不採用。
- テーマ既定をCueへ展開保存する（materialize）。→ 正本に派生値が混ざり、テーマ更新時の再解決ができなくなるため不採用。解決は常に描画時に行う。

## Consequences

- `ContentDocument` は `schemaVersion: 6` となり、必須 `visualTheme` とSceneの `accent` unionを持つ。v4/v5 は読出し時に v6 へ移行し、保存済みJSONは書き換えない。既存v5のRender Jobスナップショットも読出し移行を通して実行できる。
- `text.block@1` の入力契約は変えない。未指定プロパティの描画既定だけがテーマ由来になる。
- テーマ追加時は新ADRと新テーマ版で行い、Workごとの選択UIはそのときに導入する。
