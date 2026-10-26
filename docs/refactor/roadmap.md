# 大規模ファイル分割 ロードマップ

[spec.md](./spec.md) を正とする。この文書は、2026-10-26時点の計測に基づく優先度と実行順を記録する。行数は `wc -l`、churnは `git log --since='6 months ago' --numstat -- '*.ts' '*.tsx'` の追加+削除行数である。テストファイルも変更単位として扱う。

## 方針

- 行数だけでなく、**変更頻度**、**1機能あたりの追記量**、**責務の混在**、**参照元の多さ**、**テストの有無**で優先度を決める。
- 最初に低リスクの分割でパターンを作り、次に変更頻度の高い中核ロジック、最後に状態を持つUIを分ける。
- **優先度（放置したときのコスト）と実行順（リスク調整後）は分けて考える**。優先度が高くてもUIテストがないものは、機械的抽出を先に行う。
- 行数が多くても責務が1つにまとまっているファイルは対象外とする。

## 優先度

| 優先 | ファイル | 行数 | churn | 何が障害になるか | 分割しやすさ | テスト |
| --- | --- | ---: | ---: | --- | --- | --- |
| **S1** | `apps/web/src/content/form.ts` | 2600 | 4449 | 読み取り/書き込み/ID生成/分析が同居。1フィールド追加で複数箇所を同期 | 中（30箇所から参照） | あり（2582行） |
| **S2** | `packages/contracts/src/templates/index.ts` | 1737 | 2909 | 14テンプレートが1ファイル。新テンプレート追加のたびに肥大 | 高（純粋なスキーマ） | あり |
| **S3** | `packages/video/src/compiler.ts` | 1767 | 2810 | `compileDocument` が492行。CSS/キャラ表情/音声/遷移が同居 | 中 | あり（98テスト） |
| **S4** | `apps/web/src/components/SceneEditor.tsx` | 2416 | 4360 | 1427行の単一コンポーネント。約25フックと巨大なprops | 中（UIテストなし） | なし |
| **A5** | `packages/contracts/src/agent.ts` | 1778 | 1942 | 48操作のスキーマ・カタログ・digestが同居 | 高（定型的） | あり（digest固定） |
| **A6** | `apps/api/src/services/script-versions.ts` | 1517 | 1787 | 保存/参照検証/履歴/字幕/プレビューが同居 | 中 | あり |
| **A7** | `apps/web/src/components/CueList.tsx` | 1425 | 2373 | `CueRow`/`CueField`/入れ子Composition/再生UI | 高（既に分割済み関数） | なし |
| **A8** | `apps/web/src/api/hooks.ts` | 1219 | 1315 | 全ドメイン約80フックが1ファイル | 高（機械的） | なし |
| **B9** | `apps/api/src/services/compositions.ts` | 1141 | 1563 | バンドル検証と`CompositionService`が同居 | 中 | あり |
| **B10** | `apps/web/src/pages/ThemeDetailPage.tsx` | 1041 | 1354 | 969行の単一コンポーネント。タブUIが全部インライン | 低〜中 | なし |
| **B11** | `apps/web/src/components/LinesEditor.tsx` | 1028 | 1952 | 行編集/TTS/操作メニューが同居 | 高 | なし |
| **B12** | `apps/api/src/services/assets.ts` | 954 | 1324 | 取り込み/カーソル/フィルタ/参照/配信 | 中 | あり |
| **B13** | `apps/api/src/agent/operations.ts` | 856 | 974 | 全操作の`run`定義が1ファイル | 中 | あり |
| **C14** | `apps/web/src/pages/ThumbnailsPage.tsx` | 880 | 960 | フォーム/フィールド/プレビュー | 中 | なし |
| **C15** | `apps/web/src/pages/WorkEditPage.tsx` | 830 | 2000 | ページ/ペイン/レイアウト/ヘッダー | 中 | なし |
| **C16** | `apps/web/src/content/structural.ts` | 813 | 857 | 操作ファミリごとのコミット関数 | 高 | あり |
| **C17** | `apps/web/src/content/cueMap.ts` | 753 | 877 | モデル構築とレイアウト計算 | 高 | あり |
| **C18** | `apps/web/src/pages/FaceSetPage.tsx` | 717 | 1169 | フォーム/一覧/折りたたみ | 中 | なし |

補足:

- `form.test.ts`（2582行）と `compiler.test.ts`（2160行）は、本体とセットで分割する。テストだけを別扱いにはしない。
- `apps/web/src/components/StandingFields.tsx` は387行と短いが、churn 1179と変更頻度が高い。行数の問題ではないため今回は優先度外。UI分割時に一緒に整理する。
- 500〜700行のファイル（`packages/video/src/timeline.ts`、`packages/video/src/templates/chart-bar.ts` など）は、責務がまとまっていれば今は分割しない。**行数ではなく責務で切る**。

## 実行順

優先度が高くても、UIテストがないファイルは「移動だけ」のPhaseを先に置く。Phase 1と2は入れ替え可能だが、最初の1本は失敗コストが低く、今後の追加で必ず効くtemplatesから始める。

### Phase 1: 低リスクの成長ホットスポット（0.5〜1日）

1. `packages/contracts/src/templates/index.ts`
   - テンプレートごとのファイルに分割し、`index.ts` は公開APIのbarrel、`registry.ts` はレジストリにする。
   - `visualTemplateDefinitions` の配列順を変えない。
2. `apps/web/src/api/hooks.ts`
   - ドメインごとに分割し、`hooks.ts` はbarrelとして残す。
   - query keyとinvalidationは移動だけ。

**狙い**: 新テンプレート・新APIの追加時に、同じ巨大ファイルへ追記する構造を先に壊す。純粋なスキーマと薄いフックが中心で、失敗コストが低い。

### Phase 2: 中核ロジック（2〜3日）

3. `apps/web/src/content/form.ts` + `form.test.ts`
   - 読み取り / 書き込み / ファクトリ / 分析に分割。
   - `form.ts` はbarrelとして残し、30箇所のimportを変えない。
   - `buildCueInput` が400行を超える場合は、メディア系・データ系・テキスト系に分ける。
4. `packages/video/src/compiler.ts` + `compiler.test.ts`
   - コンパイル orchestration / scene / characters / audio / transitions / styles / nested に分割。
   - `compileDocument` は100行前後のオーケストレーターにする。
   - 出力HTMLの順序を変えない。代表的なDocumentで前後のHTMLを比較する。

**狙い**: 最もchurnが高く、テストがある中核ロジックを、安全網があるうちに片付ける。

### Phase 3: UIの機械的抽出（1〜2日）

5. `SceneEditor.tsx`
   - `TimingFields` / `InsertSceneFields` / `SceneBlock` を `components/scene-editor/` へ移設。
   - この時点ではフックの抽出はしない。2416行 → 約1400行まで減る。
6. `CueList.tsx`
   - `CueRow` / `CueField` / `CompositionVersionField` / `PositionZoomControls` / `NestedScreenField` を `components/cue-list/` へ移設。
   - 1425行 → 150行前後まで減る。
7. `LinesEditor.tsx`
   - `LineEditor` / `LineActionsMenu` / TTS生成ブロックを `components/lines-editor/` へ移設。
   - 1028行 → 200行前後まで減る。

**狙い**: すでに関数として分かれているサブコンポーネントを移すだけ。状態・ロジックを変えず、最もchurnの高いUIファイルの衝突面積を減らす。UIテストがないため、このPhaseは移動だけに限定し、最後に「編集→保存→プレビュー→レンダー」の手動スモークを通す。

### Phase 4: 契約とAPIサービス（2〜3日）

8. `packages/contracts/src/agent.ts` + `apps/api/src/agent/operations.ts`
   - protocol / catalog / template / operations（work・script・asset・render・preview・composition・tts・library）/ contract に分割。
   - `agentOperationNames` の順序を変えない。固定digestテストで検出する。
9. `apps/api/src/services/script-versions.ts`
   - `save` / `references` / `assertions` / `history` / `preview` に分割。
   - 保存時の検証順序（最初のエラーが返る順）を変えない。
10. `apps/api/src/services/assets.ts`
    - `ingest` / `list`（カーソル+フィルタ+検索）/ `manage`（取得・更新・削除・参照）/ `content` に分割。
11. `apps/api/src/services/compositions.ts`
    - バンドル検証 / `CompositionService` / クエリ関数に分割。

**狙い**: 新操作・新検証ルールの追加ごとに同じファイルへ追記する構造を壊す。API側は `.ts` 拡張子付きimportが多いため、元ファイルをbarrelとして残して解決を変えない。

### Phase 5: 状態を持つUIと残り（3〜5日）

12. `SceneEditor` のフック抽出
    - `useSceneEditorForm`（useForm/field array/dirty）
    - `useSceneStructure`（追加・削除・移動・複製・分割、Cue/立ち絵/音声のコミット）
    - `useDraftPreviewSync`（デバウンス、保存、diagnostics）
    - `useBulkTts`
    - 残りのJSXを `SceneToolbar` / `DiagnosticsPopover` などに分割。
13. `ThemeDetailPage`
    - `ColorsTab` / `TypographyTab` / `SurfacesTab` / `SkinTab` / `CaptionTab` と `useThemePreviewPlayback` に分割。
14. `WorkEditPage` / `ThumbnailsPage` / `FaceSetPage`
    - ページコンテナとフォーム・一覧・プレビューを分離。
15. `structural.ts` / `cueMap.ts`
    - `structural` は scene / line / cue / standing / audio の操作ファミリごと。
    - `cueMap` は model / layout / geometry に分離。
16. 残りのテスト分割
    - `form.test.ts` / `compiler.test.ts` / `structural.test.ts` を本体の分割に合わせる。

**狙い**: UIテストがなく、状態とpropsの移動リスクが高いものを最後に回す。Phase 3でファイルを小さくしてから、フック抽出に進む。

### Phase 6: 再発防止

17. `scripts/check-file-size.mjs` を追加する。
    - 600行超は警告、800行超は失敗。
    - 既存の違反はbaseline allowlistで除外し、分割のたびに削除する。
    - `apps/api/src/generated`、`dist`、テスト、マイグレーションは除外する。
18. CIと `AGENTS.md` を更新する。
    - `.github/workflows/ci.yml` にサイズチェックを追加する。
    - `AGENTS.md` に「1ファイル1責務」「新規ファイルは600行以下」を追記する。

**狙い**: 分割しても、次の機能追加で同じ巨大ファイルに戻るのを防ぐ。最初からCIで強制せず、主要な分割が完了してからratchetとして導入する。

## フェーズごとの効果

| Phase | 主な効果 | 完了時の状態 |
| --- | --- | --- |
| 1 | テンプレート・API追加の追記先を分散 | `templates/index.ts` が200行以下、`hooks` 配下が300行以下 |
| 2 | 最もchurnの高い変換・描画ロジックを分割 | `form` 配下が500行以下、`compiler` 配下が400行以下、`compileDocument` が150行以下 |
| 3 | UI巨大ファイルの衝突面積を削減 | `SceneEditor` 約1400行、`CueList` 約150行、`LinesEditor` 約200行 |
| 4 | 操作・検証の追加先を分散 | Agent digest不変、API flowテスト緑 |
| 5 | 状態ロジックをUIから分離 | 主要ページ・エディタが500行以下 |
| 6 | 再肥大化を防止 | 新規ファイルの上限がCIで守られる |

## 意図的に見送る項目

- **行数だけを理由にした分割**: 500〜700行でも責務が1つなら触らない。`packages/video/src/timeline.ts`、`packages/script-edits/src/apply.ts`、`packages/video/src/templates/*` など。
- **`form.test.ts` / `compiler.test.ts` の先行分割だけを行うこと**: 本体の分割に合わせて動かす。テストだけ先に分けると、importの移動が二度手間になる。
- **UIデザインの変更**: コンポーネント抽出時に見た目・文言・操作を変えない。
- **状態管理ライブラリの導入**: フック抽出以上の抽象化は、必要が生じた時点で別途設計する。
- **`apps/api/src/generated` や `dist` の整理**: 生成物・ビルド成果物は対象外。
- **ADRの追加**: ファイル分割は後戻りコストが小さいため、ADRは作らない。方針を変える場合はこの文書と [spec.md](./spec.md) を更新する。

## 前提の再検討ポイント

- `SceneEditor` のpropsがフック抽出後も複雑なままなら、`SceneEditorContext` の導入を検討する。ただし、移動コミットとは分ける。
- `buildCueInput` が分割後も400行を超えるなら、テンプレートのフィールド種別ごとに分割する。ただし `templates` の定義構造と同期させる。
- サイズチェックの閾値（600/800行）が厳しすぎる／緩すぎる場合は、分割完了後の実績を見て調整する。
- `apps/api` のbarrelは、循環依存や起動時間の問題が出た場合に、import側の変更を含めて見直す。
