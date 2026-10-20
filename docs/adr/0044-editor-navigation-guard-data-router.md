# ナビゲーションガードのためデータルーターへ移行する

未保存の台本があるときの画面内遷移・戻る/進む・リロード/タブ閉じを一貫してガードするため、`react-router-dom` を `<BrowserRouter>` + `<Routes>` から `createBrowserRouter` + `RouterProvider` のデータルーター構成へ移行し、`useBlocker`（画面内遷移）と `useBeforeUnload`（リロード/タブ閉じ）を使う。仕様は [../editor-ux/spec.md](../editor-ux/spec.md) を正とする。

- `useBlocker` はデータルーターでのみ動作する。宣言的 `<Routes>` では画面内遷移をブロックできない。
- 目的は正本の未保存編集を失わせないことであり、「保存は明示操作のみ」という方針（[../preview-workflow/spec.md](../preview-workflow/spec.md)）は変えない。
- URL・ページレイアウトは維持する。

理由は、自前の `beforeunload` + クリック横取り + `popstate` では SPA 遷移の維持と戻る/進むの捕捉が壊れやすく、データルーターの blocker はこの用途に標準機構として用意されているため。

## Considered Options

- データルーターへ移行せず、ヘッダーリンクのクリック横取りと `beforeunload` で代用する。→ SPA 遷移を保てず、戻る/進むを確実に捕捉できないため不採用。
- 独自の履歴スタックを持つ。→ `react-router` と二重管理になり保守コストが高いため不採用。

## Consequences

- `apps/web/src/main.tsx` は `createBrowserRouter`/`RouterProvider` を使う。`apps/web/src/App.tsx` はルート定義（ルートレイアウト＋`PageLayout` 子）へ置き換える。
- 未保存の真偽は `SceneEditor` から即時に `WorkEditPage` へ伝播する（保存用のデバウンスとは別）。`WorkEditPage` が `useBlocker`/`useBeforeUnload` を所有する。
- ルーター移行は画面の見た目とURLを変えない。ブロック判定は純関数／フックの小さい単位に閉じ、ルーター内部に依存したテストを書かない。
