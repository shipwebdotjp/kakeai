# エディタの退出ガード・診断表示・ラベル 実装TODO

仕様は [spec.md](./spec.md) を正とする。上から順に進め、各フェーズで `npm run typecheck`・`npm test`・OCRレビューを実行し、妥当な指摘を修正してコミットする。保存は引き続き明示操作のみ。

## P1 未保存の退出ガード

- [ ] `apps/web/src/main.tsx` を `createBrowserRouter` + `RouterProvider` へ移行する（[../adr/0044-editor-navigation-guard-data-router.md](../adr/0044-editor-navigation-guard-data-router.md)）
- [ ] `apps/web/src/App.tsx` の `<Routes>` を route 定義へ置き換える（ルートレイアウト＋`PageLayout` 子。URL・レイアウトは不変）
- [ ] `SceneEditor` に `onDirtyChange(boolean)` を追加し、`formState.isDirty` を即時伝播する（保存用ドラフト送信のデバウンスとは別系統）
- [ ] `WorkEditPage` に `useBlocker(dirty)` と `useBeforeUnload` を導入し、確認ダイアログで `proceed()`/`reset()` する
- [ ] 作品名の未保存（`titleDraft !== null`）も dirty に含める
- [ ] 保存成功で未保存が解除され、ガードも解除されることを確認する
- 完了条件: 未保存編集があるままの画面内遷移・戻る/進む・リロード/タブ閉じで確認が出て、保存後は出ない。URLと画面レイアウトは従来どおり。

## P2 保存時の診断サマリとジャンプ

- [ ] `SceneEditor` の `issues: string[]` を `Diagnostic[]` へ変更し、Zod issues の `path` を保持する
- [ ] サーバー拒否時の `ApiError.details.issues` を `Diagnostic` へ展開する（`details` 無しはメッセージ1件）
- [ ] 保存成功時の `result.warnings` を `Diagnostic` として保持する
- [ ] 固定バー `#editor-actionbar` に「エラー(N)」「警告(N)」チップ（`lucide-react`）を追加し、0件は非表示にする
- [ ] チップクリックでバー直下に折りたたみパネルを展開し、既存の警告・エラーボックスを統合する
- [ ] 純関数 `diagnosticTarget(path, scenes)` を `apps/web/src/content/` に追加する（`scenes`→`scene-` / `lines`→`line-` / `visualCues`→`cue-`）
- [ ] パスクリックで `WorkEditPanes.jump()` を呼び、中央ペインのスクロールとプレビューシークを行う
- [ ] 対応要素の無いパス（characters/speakers 等）はリンクにせず表示のみにする
- [ ] テスト: `diagnosticTarget` の対応（scene/line/cue、範囲外、未知セグメント）のみを対象にする。UI文言は検証しない
- 完了条件: 保存実行後に件数が固定バーへ出て展開でき、警告・検証エラーのパスクリックで該当箇所へ移動できる。

## P3 表示ラベルの日本語化

- [ ] `packages/contracts/src/templates/index.ts` の `FIT_OPTIONS` ラベルを日本語化し、`fit` フィールドのラベルを「表示方法」にする
- [ ] `apps/web/src/components/CueList.tsx` の `nestedMedia` の fit セレクトを同じ日本語ラベルへ揃える
- [ ] `Composition Version ID` のラベルを「Composition バージョン」にする
- [ ] ドキュメント同期: [./spec.md](./spec.md)、必要ならユーザーガイド（実装後に反映）
- 完了条件: `fit` のセレクトと `Composition Version ID` が日本語で表示される。

## P4 後続（本TODOの対象外）— エディタの視認性刷新

別フェーズとして実施する。詳細は [spec.md](./spec.md) の「後続フェーズ」を参照。

- [ ] `apps/web/src/ui.ts` に `sectionCardClass`・`sectionTitleClass`・`fieldLabelClass`・`badgeClass` を追加する
- [ ] 低頻度項目を折りたたみ（既定閉）にし、常用項目を常時表示にする
- [ ] Scene種別バッジ、警告／エラー／成功の色分け、見出しのジャンプ率とコントラストを強化する
- [ ] `lucide-react` のアイコンをナビゲーション・セクション見出し・チップへ適用する
