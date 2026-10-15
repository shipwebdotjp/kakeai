# エディタの退出ガード・診断表示・ラベル 仕様

この文書は、編集画面（`WorkEditPage` / `SceneEditor`）における次の3点を正とする。

1. 未保存のまま退出・遷移するときの警告確認。
2. 保存時に発生した警告・エラーの、固定バーでの件数表示・展開・該当箇所へのジャンプ。
3. エディタに残る英語表記（`fit`/`cover`/`contain` と `Composition Version ID`）の日本語化。

台本の契約は [../mvp/content-schema.md](../mvp/content-schema.md)、編集画面の構成は [../editor/spec.md](../editor/spec.md)、プレビューの移動・ドラフトは [../preview-workflow/spec.md](../preview-workflow/spec.md) を正とする。未保存ガードの方式決定は [ADR-0044](../adr/0044-editor-navigation-guard-data-router.md) を参照する。

## 目的と境界

- 保存は引き続き明示操作のみとする（自動保存はしない）。
- 警告は保存を拒否せず `meta.warnings` で返す既存方針（[ADR-0014](../adr/0014-text-overflow-warning-not-rejection.md)）を維持する。
- 警告・エラーの件数は**保存実行時にのみ**算出する。編集中のライブ計算は行わない。
- プレビュー・レンダーの対象は常に保存済み版であり、ドラフト編集とは独立に保つ。

## Phase 1 — 未保存の退出ガード

### ルーター構成

- `apps/web/src/main.tsx` を `<BrowserRouter>` から `createBrowserRouter` + `RouterProvider` へ変更する（[ADR-0044](../adr/0044-editor-navigation-guard-data-router.md)）。
- `apps/web/src/App.tsx` の `<Routes>` を route オブジェクトへ置き換える。ルートレイアウト（ヘッダ＋`<Outlet/>`）配下に、`/works/:workId`（`WorkEditPage`、`PageLayout` の外）と `PageLayout` 子（`/`・`/assets`・音声・キャラクター・コンポジション・`*`）を置く。URLとページレイアウトは変えない。

### 未保存状態の伝播

- `SceneEditor` は `formState.isDirty` を `onDirtyChange(boolean)` で即時に上位へ伝える。これは保存用のドラフト送信デバウンス（[../preview-workflow/spec.md](../preview-workflow/spec.md)）とは別系統とする。
- `WorkEditPage` は台本の未保存に加え、作品名の未保存（`titleDraft !== null`）も未保存として扱う。

### ガード

- `WorkEditPage` が `useBlocker(dirty)` を所有し、画面内遷移（ヘッダーナビ・作品一覧リンク・戻る/進む）をブロックする。ブロック時はブラウザ標準の `window.confirm` を出し、確定で `proceed()`、取消で `reset()` する（既存の削除確認と同じ方式）。
- リロード・タブ閉じは `useBeforeUnload` でガードする。
- 保存成功時は未保存状態を解除し（既存の `onSaved` 経路）、ガードも解除される。

## Phase 2 — 保存時の診断サマリとジャンプ

### 診断モデル

診断は次の形で扱う。

```ts
interface Diagnostic {
  path?: (string | number)[]; // 正本Document内のパス（任意）
  code?: string;
  message: string;
}
```

- **警告**: 保存成功時の `result.warnings`（`Warning` の `path`・`code`・`message`）を保持する。編集中のライブ計算はしない。
- **エラー**:
  - 保存前のクライアント検証（`buildContentDocument` の例外、`contentDocumentSchema` の Zod issues）を `Diagnostic` に変換する。Zod issues は `path` を保持する（現状の文字列化をやめる）。
  - サーバー拒否時の `ApiError.details.issues`（`{ path, code, message }`、[../../apps/api/src/http/validation.ts](../../apps/api/src/http/validation.ts)）を `Diagnostic` へ展開する。`details` が無い場合は `{ message }` 1件とする。

### 固定バーでの表示

- `#editor-actionbar`（`SceneEditor` の sticky バー）に「エラー(N)」「警告(N)」のチップを出す。0件の種別は表示しない。
  - エラー: 赤系、警告: amber系。アイコンは `lucide-react`（例 `OctagonAlert` / `TriangleAlert`）を使う。
- チップのクリックで、バー直下に折りたたみパネル（`max-height` + overflow）を開閉する。パネルは押したチップの種別だけを一覧表示し、もう一方のチップを押すとその種別へ切り替える。各項目にメッセージと、`path` がある場合はクリック可能なパス表示を出す。
- 保存成功時の既存の警告ボックス・保存失敗時の既存のエラーボックスは、このパネルへ統合する。

### 該当箇所へのジャンプ

- `path` クリックで、対応するフォーム要素へ中央ペインをスクロールし、プレビューを該当区間へシークする（既存の `WorkEditPanes.jump()` を再利用）。
- パス→対象の対応は純関数 `diagnosticTarget(path, scenes)` で行う。実装は `apps/web/src/content/diagnostics.ts` に置き、同ディレクトリに単体テストを追加する。返す対象は `{ targetId, seek }` とし、既存の要素id規約に合わせる。
  - `scenes[s]` → `scene-{id}`
  - `scenes[s].lines[l]` → `line-{id}`
  - `scenes[s].visualCues[c]` → `cue-{id}`
- インデックス整合: 正本Documentの `scenes`/`lines` 順はフォーム順と一致する。`visualCues` はフォームの `cues` 順の後に立ち絵Cueが続くため、`c <= form cues.length - 1` の範囲で `cue-{id}` に対応する。
- `characters`・`speakers` 等、対応する要素idが無いパスの項目はリンクにせず表示のみとする。

## Phase 3 — 表示ラベルの日本語化

- `packages/contracts/src/templates/index.ts` の `FIT_OPTIONS` のラベルを日本語化する（例: `cover` → 「全体を覆う（切り抜き）」、`contain` → 「全体を収める」）。`fit` フィールドのラベルは「表示方法」とする。
- `apps/web/src/components/CueList.tsx` の `nestedMedia` の fit セレクト（ハードコードの `fit`/`cover`/`contain`）を同じ日本語ラベルへ揃える。
- `Composition Version ID` フィールドのラベルを「Composition バージョン」とする。
- `@version` サフィックスや Scene id などの技術的識別子は、リンクやツールチップの対象だが、現時点では表示を維持する。

## Phase 4 — エディタの視認性・操作性刷新

频用操作を主表示、技術的・低頻度設定を詳細表示に寄せる。既定利用者は初中級の日本語解説動画制作者とする。保存・ドラフトプレビュー・診断・正本JSON契約は変更しない。

### レイアウトモデル

- 横幅1280px以上では3ペインを維持する。
- 初期比率は左20%・プレビュー36%（中央は残り44%）とする。
- 左ペインは192〜360px、中央ペインは最低480px、プレビューは最低360pxとする。プレビューは最大でワークスペース幅の50%まで広げられる（中央の最低幅を守る範囲に限る）。
- ペインの境目のドラッグとキーボード（`←`/`→`）で比率を変更できる。

### レイアウトの永続化

- 分割比率は `localStorage` の `kakeai-editor-layout-v1` に比率で保存する。作品データへは保存せず、同一ブラウザ・同一オリジンだけのUI設定とする。
- 再表示・画面幅変更時は制約内へ丸めて復元する。破損値・保存不可時は既定値へ戻す。
- 折りたたみの開閉状態は保存しない。再表示・モード切替では既定の開閉に戻る。
- 「レイアウトをリセット」で保存値を破棄し、既定比率へ戻す。
- 読込・保存・不正値の無視・幅変更時のクランプは純関数 `apps/web/src/lib/editorLayout.ts` に集約し、同ディレクトリに単体テストを追加する。UI文言そのものを検証するテストは追加しない。

### 狭幅モード（横幅1280px未満）

- 構成（左ペイン）をドロワー化し、「編集／確認」切替へ移行する。編集は中央ペイン、確認はプレビューとレンダーとする。左ペインのドロワーは両方の表示から開ける。
- モバイル専用UIは対象外とし、狭い画面では集中モード（どちらか一方の表示）を優先する。
- 3ペインは常時マウントし、CSSの表示制御だけで切り替える。切替でフォーム入力・未保存状態・スクロール位置・再生状態を破棄しない。
- ドロワーからのジャンプは編集表示へ戻した上で、中央ペインのスクロールとプレビューシークを行う。

### 共通プリミティブ

- `apps/web/src/ui.ts` にセクション、見出し、種別・状態バッジ、詳細表示（`<summary>`）、アイコン操作の共通スタイルを追加する。見出し階層、フォーカス表示、文字コントラスト、アイコンのみの操作のラベルを統一する。
- 折りたたみは子を常時マウントしたまま表示だけを切り替える `Collapsible` を使う。react-hook-form の値を保持する。

### シーン

- 全シーンの展開状態は維持する（シーン自体を畳まない）。
- 各シーンは、名称・種別バッジ・ID・複製／移動／削除を明確なヘッダーへ集約する。削除は危険操作として視覚的に区別する。
- アクセント・尺・遷移と尺の内訳は「シーン設定」に畳む。

### 作品設定

- テーマ、BGM、キャラクターを要約付きの折りたたみへ移し、既定で閉じる。
- キャラクター未登録時だけは追加導線を開いた状態にする。

### Cue

- 内容入力を先に表示し、レイヤー・順序・表示区間・入退場を「表示の詳細」に移す。
- `text.block` はテキストと役割を常時表示し、位置・フォント・色・装飾を「文字スタイル」に畳む。

### 立ち絵

- キャラクター／外観を主表示にし、倍率・入退場を詳細へ移す。

### セリフ

- 字幕・読み上げ・話者・プレビュージャンプを主表示にし、Take管理と表情・TTSの声・話速設定を「音声詳細」へ整理する。

### 左ペイン

- 現在位置、Scene種別、Cue・セリフの要約を明確にする。テキストCueは役割だけでなく本文先頭も表示する。

### プレビューとレンダー

- プレビューは再生・移動を優先したツールバーに整理する。
- レンダー履歴は出力操作を残したまま低優先表示にする。
- 既存の診断チップ、未保存・保存成功状態は固定バーで明確に表示する。

### 非ゴール

- HTTP API、ContentDocument、DB、VisualTemplate契約の変更。
- レイアウト比率の作品データへの保存。
- 折りたたみの開閉状態の保存。
- モバイル専用UI。

### 受け入れ条件

- 1280px以上でプレビューを現行上限（760px）以上に広げられ、再読込後も比率が制約内で安全に復元される。
- 狭い画面で編集／確認を切り替えても、フォーム入力・未保存状態・プレビュー位置が失われず、構成ドロワーのジャンプが編集画面へ戻る。
- 全Sceneが表示されたまま、詳細を開閉しても既存値・保存・診断ジャンプ・ドラフトプレビューが維持される。
- `npm run typecheck`、`npm test`、OCRレビューを通す。UI文言そのものを検証するテストは追加しない。

## 非ゴール

- 自動保存。保存は明示操作のみ。
- 編集中の警告・エラーのライブ計算（今回は保存実行時のみ）。
- 診断からのジャンプ対象を、対応する要素idの無いdocument-level項目（characters/speakers/audioCues等）へ広げること。
- `@version` サフィックスや Scene id の非表示化。

## 受け入れ条件

- 未保存の編集があるまま、ヘッダーナビ・作品一覧・戻る/進む・リロード/タブ閉じを行おうとすると確認が出る。保存成功後は確認が出ない。
- 保存実行後、固定バーに「エラー(N)」「警告(N)」が件数付きで出て、クリックで展開できる。
- 警告（例: `scenes.1.lines.12.captionText`）のパスクリックで、中央ペインが該当セリフへスクロールし、プレビューが該当区間へ移動する。
- サーバー検証エラー（`details.issues`）も同じ形式で件数表示・ジャンプできる。パスが無いエラーはメッセージのみ表示する。
- `fit` のセレクトと `Composition Version ID` が日本語で表示される。
