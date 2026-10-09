# CompositionコンパイラはAsset解決方法を知らない（assetResolver注入）

Amended by [ADR-0023](./0023-preview-composition-contract.md): `assetResolver` は `{ url, kind }` を返す。

Composition コンパイラは Asset の解決方法（HTTP URL かローカルパスか）を知らず、Asset ID を表示参照へ変換する `assetResolver` を入力として受け取る。プレビューは HTTP content URL を、レンダーはローカルファイルパスを注入する。

理由は、プレビューとレンダーで同一のコンパイラと信頼済み VisualTemplate を使いつつ、解決方式の違いを呼び出し側に閉じ込めるため。コンパイラ内に `if (preview)` の分岐を入れると、テンプレート変更が二重管理になり必ずドリフトする。

## Considered Options

- プレビュー用とレンダー用にコンパイラを分ける。→ 実装が二重化するため不採用。
- レンダーも HTTP 経由で API から素材取得する。→ ワーカー単体起動とオフライン要件に反するため不採用。

## Consequences

コンパイラの公開契約に `assetResolver: (assetId) => string` を含める。Asset ID の妥当性検証はコンパイル前に行い、未解決の ID は `ASSET_NOT_FOUND` / `ASSET_UNAVAILABLE` として扱う。
