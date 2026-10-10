# Composite Visual Template と分離（NestedVisual再帰・scope）

複合ビジュアルを、信頼済み `VisualTemplate` の入力内に再帰的な `NestedVisual`（`media` または信頼済みtemplate参照）を置く構造で表す。再帰はテンプレート入力内だけに閉じ、文書レベルは `layer`/`order` とCue全体のtransition に留める。

- 上限は深さ8・総ノード64。子Visualのテンプレート存在・入力・素材参照はDocumentの再帰walkerで検証する。
- 各rendererはHTML断片・素材参照・ローカル時刻のAnimationPlanのみ返し、GSAPタイムラインとComposition HTMLはトップレベルコンパイラだけが生成する。
- Cue IDを可逆なDOM-safe文字列へ符号化したscopeを作り、子Visualは構造パス由来のsuffixを付ける。DOM ID・`getElementById`・CSSセレクタ・AnimationPlan targetはscope配下のみを参照する。テンプレートは `<script>`・グローバルID・グローバルquery selectorを返さない。

理由は、HyperFramesの入れ子Compositionに相当する表現を、任意HTMLを正本に持ち込まずに安全に実現するため。scope分離により、複数Cue・入れ子・同一テンプレート重複配置でもIDとアニメーションが衝突しない。最初の複合ビジュアルは `scene.device-frame@1`（背景・カードに画像/動画を収める）。

## Considered Options

- HyperFramesの `data-composition-src` で外部HTMLサブCompositionを読み込む。→ 任意HTMLの保存・実行は [ADR-0001](./0001-canonical-json-over-derived-media.md) とセキュリティ境界に反するため不採用。
- 文書レベルも再帰（SceneをサブComposition化）する。→ まずは入力内再帰に閉じ、将来 `Visual` ツリーへ拡張できる余地を残す。
- 各テンプレートが直接グローバルIDを出力する。→ 複数配置で衝突するため不採用。

## Consequences

- `packages/contracts` に `nestedVisualSchema` とテンプレート定義の `collectAssetRefs` を集約し、`assetBearingTemplateKeys` を廃止する。
- 複数Cue・入れ子での衝突を検証するコンパイラテストを追加する。
