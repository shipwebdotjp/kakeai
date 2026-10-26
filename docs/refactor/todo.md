# 大規模ファイル分割 実装TODO

[spec.md](./spec.md) と [roadmap.md](./roadmap.md) を正とする。上から順に進める。各Phaseの最後に `npm run typecheck` と `npm test` を通す。

## Phase 0: 基準と規約

- [ ] 2026-10-26時点のベースラインを記録する（`wc -l`、6ヶ月churn）
- [ ] 分割の規約（1ファイル1責務、barrel、移動優先、テスト同時分割）を共有する
- [ ] 必要なら `AGENTS.md` にファイルサイズの目安を追記する
- [ ] 各Phaseの完了条件を確認する

完了条件: 対象ファイル、優先度、実行順、完了判定が共有されている。

## [x] Phase 1: 成長ホットスポット

### [x] T1 `packages/contracts/src/templates/index.ts`

- [x] テンプレート定義を `text-block.ts` / `media.ts` / `character-standing.ts` / `device-frame.ts` / `site-mockup.ts` / `composition-full-bleed.ts` / `table.ts` / `chart.ts` / `list-callout.ts` / `flow.ts` / `stat.ts` / `quote.ts` / `chat.ts` に分ける
- [x] `shared.ts` に `TemplateDisplay` / `TemplateFieldSpec` / `VisualTemplateDefinition` を移す
- [x] `common.ts` / `figure.ts` / `line-refs.ts` / `lookup.ts` / `nested-refs.ts` に共通処理を分ける
- [x] `index.ts` をbarrelにし、`registry.ts` を再エクスポートする
- [x] `visualTemplateDefinitions` の配列順を変えない
- [x] `templates.test.ts` を通す

完了条件: `index.ts` が200行以下になり、新テンプレート追加が「定義ファイル + registryの1行」で済む。

### [x] T2 `apps/web/src/api/hooks.ts`

- [x] 作品・素材・台本版・Job・声・TTS・キャラクター・FaceSet・Theme・Font・Composition・Thumbnailに分ける
- [x] `hooks/index.ts` をbarrelとして残す
- [x] query keyの文字列とinvalidationを変えない
- [x] 既存のimportパス（`../api/hooks`）を変えない

完了条件: 各ファイル300行以下、既存画面の型検査が通り、クエリの挙動が変わらない。

## Phase 2: 中核ロジック

### [ ] T3 `apps/web/src/content/form.ts` + `form.test.ts`

- [ ] `types.ts` / `constants.ts` / `read.ts` / `cue.ts` / `document.ts` / `factories.ts` / `analysis.ts` に分割する
- [ ] `form.ts` をbarrelとして残す
- [ ] `form.test.ts` を `form/read.test.ts` / `form/build.test.ts` / `form/factories.test.ts` / `form/analysis.test.ts` に分ける
- [ ] `toFormValues` → `buildContentDocument` の往復テストを維持する
- [ ] `buildCueInput` が400行を超える場合は、メディア系・データ系・テキスト系に分ける

完了条件: `form` 配下の各ファイルが500行以下（`buildCueInput` は400行以下）、テストファイルが対応モジュールを特定でき、往復テストが通る。

### [ ] T4 `packages/video/src/compiler.ts` + `compiler.test.ts`

- [ ] `compile.ts` / `scene.ts` / `nested.ts` / `characters.ts` / `audio.ts` / `animation.ts` / `transitions.ts` / `styles.ts` に分割する
- [ ] `compileDocument` を100行前後のオーケストレーターにする
- [ ] `compiler.ts` をbarrelとして残す
- [ ] `compiler.test.ts` をモジュール単位に分割する
- [ ] 代表的なDocumentでリファクタリング前後のHTMLを比較する

完了条件: `compileDocument` が150行以下、98件のテストが通り、出力HTMLが一致する。

## Phase 3: UIの機械的抽出

### [ ] T5 `SceneEditor.tsx`

- [ ] `TimingFields` を `components/scene-editor/TimingFields.tsx` へ移す
- [ ] `InsertSceneFields` を `components/scene-editor/InsertSceneFields.tsx` へ移す
- [ ] `SceneBlock` を `components/scene-editor/SceneBlock.tsx` へ移す
- [ ] `SceneEditor.tsx` はコンテナとして残す
- [ ] propsとコールバックの意味を変えない

完了条件: `SceneEditor.tsx` が約1400行以下、型検査が通り、編集→保存→プレビューが動く。

### [ ] T6 `CueList.tsx`

- [ ] `CueRow` / `CueField` / `CompositionVersionField` / `PositionZoomControls` / `NestedScreenField` を `components/cue-list/` へ移す
- [ ] `CueList.tsx` はコンテナとして残す
- [ ] フィールド種別ごとの分岐と表示を変えない

完了条件: `CueList.tsx` が200行以下、型検査が通り、Cueの追加・編集・削除が動く。

### [x] T7 `LinesEditor.tsx`

- [ ] `LineEditor` / `LineActionsMenu` / TTS生成ブロックを `components/lines-editor/` へ移す
- [ ] `LinesEditor.tsx` はコンテナとして残す
- [ ] 構造操作のコールバックとTTS生成の挙動を変えない

完了条件: `LinesEditor.tsx` が250行以下、型検査が通り、行の追加・移動・分割・複製・削除・音声生成が動く。

補足: Phase 3は移動のみとし、状態フックの抽出はPhase 5で行う。最後に手動で「編集→保存→プレビュー→レンダー」を通す。

## Phase 4: 契約とAPIサービス

### [ ] T8 `packages/contracts/src/agent.ts` + `apps/api/src/agent/operations.ts`

- [ ] `agent.ts` を `protocol.ts` / `catalog.ts` / `template.ts` / `operations/*` / `schemas.ts` / `contract.ts` に分割する
- [ ] `agent.ts` をbarrelとして残す
- [ ] `operations.ts` を同じドメイン単位の `run` 定義に分割する
- [ ] `agentOperationNames` の順序を変えない
- [ ] 固定digestテスト（`fnv1a64:dfbb1f98a6d14526`）を通す

完了条件: `agent.ts` と `operations.ts` が300行以下、digestが不変、Agent操作のテストが通る。

### [x] T9 `apps/api/src/services/script-versions.ts`

- [ ] `save.ts` / `references.ts` / `assertions.ts` / `history.ts` / `preview.ts` に分割する
- [ ] `script-versions.ts` をbarrelとして残す
- [ ] 保存時の検証順序（最初のエラーが返る順）を変えない
- [ ] `render-flow.test.ts` / `preview-flow.test.ts` / `script-edits.test.ts` を通す

完了条件: 各ファイル400行以下、保存・プレビュー・字幕のテストが通る。

### [x] T10 `apps/api/src/services/assets.ts`

- [ ] `ingest.ts` / `list.ts` / `manage.ts` / `content.ts` に分割する
- [ ] `assets.ts` をbarrelとして残す
- [ ] カーソルの形式、フィルタの意味、参照検索の挙動を変えない
- [ ] `asset-flow.test.ts` / `asset-search.test.ts` を通す

完了条件: 各ファイル400行以下、アップロード・検索・削除・配信のテストが通る。

### [ ] T11 `apps/api/src/services/compositions.ts`

- [ ] `validation.ts` / `service.ts` / `queries.ts` に分割する
- [ ] `compositions.ts` をbarrelとして残す
- [ ] バンドル検証の順序とエラーコードを変えない
- [ ] `composition-library.test.ts` / `composition-authoring.test.ts` を通す

完了条件: 各ファイル500行以下、Compositionの作成・保存・公開・解決のテストが通る。

## Phase 5: 状態を持つUIと残り

### [ ] T12 `SceneEditor` のフック抽出（一部完了）

- [ ] `useSceneEditorForm` に useForm・field array・dirty通知を移す
- [ ] `useSceneStructure` に Scene/行/Cue/立ち絵/音声の構造操作を移す
- [ ] `useDraftPreviewSync` にデバウンス・保存・diagnosticsを移す
- [ ] `useBulkTts` に一括TTSの状態を移す
- [ ] 残りのJSXを `SceneToolbar` / `DiagnosticsPopover` などに分ける

完了条件: `SceneEditor.tsx` が500行以下、保存・プレビュー・構造操作の手動スモークが通る。

### [ ] T13 `ThemeDetailPage.tsx`

- [ ] `ColorsTab` / `TypographyTab` / `SurfacesTab` / `SkinTab` / `CaptionTab` に分割する
- [ ] `ThemePreviewPane` と `useThemePreviewPlayback` を分離する
- [ ] フォームの初期化・dirty・保存・プレビュー復帰の挙動を変えない

完了条件: `ThemeDetailPage.tsx` が300行以下、Themeの編集・保存・プレビューが動く。

### [ ] T14 ページコンポーネント

- [ ] `WorkEditPage` をヘッダー・Edition選択・ペイン・レイアウトに分ける
- [ ] `ThumbnailsPage` をフォーム・フィールド・プレビューに分ける
- [ ] `FaceSetPage` をフォーム・一覧・下書き生成に分ける

完了条件: 各ページが500行以下、既存の操作が動く。

### [ ] T15 `structural.ts` / `cueMap.ts`

- [ ] `structural` を scene / line / cue / standing / audio / common に分ける
- [ ] `cueMap` を model / layout / geometry に分ける
- [ ] 操作の意味論とCue Mapの表示を変えない
- [ ] `structural.test.ts` / `cueMap.test.ts` を分割する

完了条件: 各ファイル400行以下、構造操作とCue Mapのテストが通る。

### [x] T16 残りのテスト分割

- [ ] `form.test.ts` / `compiler.test.ts` / `structural.test.ts` を本体の分割に合わせる
- [ ] テストの共通fixtureを必要最小限に整理する
- [ ] 巨大な統合テストはシナリオ単位で分ける

完了条件: テストファイルが800行以下、失敗箇所がモジュール単位で特定できる。

## Phase 6: 再発防止

### [x] T17 ファイルサイズチェック

- [ ] `scripts/check-file-size.mjs` を追加する
- [ ] 600行超は警告、800行超は失敗にする
- [ ] `apps/api/src/generated`、`dist`、テスト、マイグレーションを除外する
- [ ] 既存の違反はbaseline allowlistで除外する
- [ ] `.github/workflows/ci.yml` にチェックを追加する

完了条件: 新規の巨大ファイルがCIで検出され、baselineは分割のたびに減る。

### [ ] T18 最終確認

- [ ] `npm run typecheck` と `npm test` を通す
- [ ] `roadmap.md` の優先度S/Aのファイルが目標サイズ内にある
- [ ] 公開exportとimportパスに互換性がある
- [ ] Agent digest、VisualTemplate registryの順序、レンダーHTMLが不変
- [ ] `AGENTS.md` と [spec.md](./spec.md) を最終状態に合わせる

完了条件: 受け入れ条件を満たし、再発防止のチェックがCIで動いている。

## 進捗メモ（2026-10-26）

- Phase 1（T1・T2）は完了。
- T3 は `form.ts` の本体分割まで完了。`form.test.ts` の分割は T16 で行う。
- T4 は `compiler.ts` の本体分割まで完了。`compiler.test.ts` の分割は T16 で行う。
- T5 は `TimingFields` / `InsertSceneFields` / `SceneBlock` の抽出まで完了。`SceneEditor` 本体のフック抽出は T12 で行う。
- T6（CueList）は未着手。
- T7（LinesEditor）は完了。
- T15 は `structural.ts` / `cueMap.ts` の本体分割まで完了。テスト分割は T16 で完了。
- T8 は `packages/contracts/src/agent.ts` の分割まで完了。`apps/api/src/agent/operations.ts` は未着手。
- T9（script-versions）・T10（assets）は完了。
- T11（compositions）は分割完了。`service.ts` が620行のため、追加分割をフォローする。
- T12 は `useSceneEditorForm` / `useSceneEditorBulkTts` / `useSceneEditorSave` を抽出。構造操作・BGM・タイムライン計算のフック抽出は残り。
- T16 は `form.test.ts` / `compiler.test.ts` / `structural.test.ts` / `cueMap.test.ts` の分割まで完了。
- T17（ファイルサイズチェック）は完了。`npm run check:file-size` をCIに追加した。
- 現在の800行超ファイルは SceneEditor / CueList / ThemeDetailPage / ThumbnailsPage / LineEditor / api agent operations / WorkEditPage の7件。
