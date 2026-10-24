# 視覚確認（R3-4）実装TODO

[仕様](./spec.md) を正とする。全体方針は [Agent Access 仕様](../agent-access/spec.md) に従い、判断は [ADR 0078](../adr/0078-agent-preview-frame-image-transport.md) を正とする。

## フェーズ

### [x] C1 操作コア

- [x] `packages/contracts` に `agentPreviewFrameInputSchema`（`{ artifactId, timeMs }`）と `agentPreviewFrameOutputSchema`（`{ artifactId, requestedTimeMs, resolvedTimeMs, width, height, mimeType, pngBase64 }`）を追加し、`preview.frame` を操作名・読み取り分類・入出力対応表へ登録する
- [x] `apps/api` に `preview.frame` の定義を追加する。`role: "render"`・`format: "mp4"` 以外は `VALIDATION_ERROR`、`durationMs` 超過の `timeMs` は `VALIDATION_ERROR`、未知・実体欠落は `RESOURCE_NOT_FOUND` とし、抽出は `still-frame.ts` の再利用とする
- [x] 契約テストとソケット統合テストで、正常系（PNG の署名・寸法・解決時刻）、`RESOURCE_NOT_FOUND`、`VALIDATION_ERROR`（範囲外時刻・非動画成果物）を検証する
- 完了条件: ソケット越しに render 成果物の指定時刻の PNG が base64 で返り、異常系が安定コードで返る。

### [x] C2 MCP 束縛

- [x] 成功結果に標準の image コンテントブロックを1つ追加し、`kakeai_preview_frame` が絵とメタ情報を同時に返す
- [x] MCP テストで image ブロックの存在・`mimeType`・`text`／`structuredContent` との一致を検証する
- 完了条件: MCP 経由で `preview.frame` の画像が取得できる。

### [x] C3 CLI 束縛

- [x] `--out <path.png>` を追加し、指定時は PNG をファイルに書いて stdout JSON の `pngBase64` を `path` に置き換える
- [x] CLI テストでファイル書込みと stdout の形を検証する
- 完了条件: CLI 経由で PNG ファイルの保存と JSON 取得の両方ができる。

### [x] C4 文書・スキル・ガイド

- [x] [Agent Access 仕様](../agent-access/spec.md) の操作表・可逆な変更・束縛の説明へ `preview.frame` を反映する
- [x] `docs/agent-access/roadmap.md` の保留「視覚確認（R3-4）」と制約表を完了へ改め、`docs/agent-access/todo.md` に B6 を追加する
- [x] ユーザーガイドのツール表・CLI 例・`--out` を更新する
- [x] `kakeai-production` スキルに Visual QA の手順を追加し、Non-goals の「自律的な目視確認」記述を改める（最終判断は人に残す）
- [x] `CONTEXT.md` に Preview Frame の用語を追加する
- 完了条件: 仕様・roadmap・todo・ガイド・スキル・用語が互いに矛盾しない。

### [x] C5 レビューとコミット

- [x] `npm run typecheck`、`npm test`、最大3回の OCR レビューで妥当な指摘を修正し、コミットする

## V2 レンダー前の視覚確認

判断と実測は [spike.md](./spike.md)、契約は [spec.md](./spec.md) を正とする。

### [x] D1 保存版プレビュー

- [x] `@hyperframes/engine` と `@hyperframes/core/runtime-script` で、保存版 HTML を headless シークして PNG 化するラスタライザを追加する
- [x] runtime を composition の inline script より先に `<head>` へ注入する
- [x] same-origin の media session cookie を受けるため `/api/v1/preview-host` を追加する
- [x] `preview.scriptFrame`（`{ scriptVersionId, timeMs }`）を操作コア・契約へ追加する
- [x] MCP の image ブロックと CLI `--out` を画像操作へ一般化する
- [x] Fake rasterizer のサービステストとソケット統合テストを追加する

### [x] D2 素材プレビュー

- [x] `preview.assetFrame`（`{ assetId, timeMs? }`）を追加する
- [x] 画像は原本バイト、動画は `still-frame.ts` の PNG、音声は `VALIDATION_ERROR` とする
- [x] 画像サイズ上限と MIME の契約を追加する
- [x] サービステストで画像・動画・音声・未知 ID を固定する

### [x] D3 文書・スキル・ガイド

- [x] `docs/visual-confirmation/spec.md` / `roadmap.md` / `spike.md` を更新する
- [x] `docs/agent-access/spec.md` の操作表・束縛・説明を更新する
- [x] `docs/agent-mp4-production/todo.md` / `roadmap.md` の P3 の状態を更新する
- [x] `skills/kakeai-production/SKILL.md` に render 前後の Visual QA を追加する
- [x] `user-guide/docs/agent-access.md` のツール表・CLI 例・`--out` を更新する
- [x] `CONTEXT.md` に用語を追加する

### [x] D4 検証とコミット

- [x] `npm run typecheck` と `npm test` を通す
- [x] OCR レビューの正当な指摘を修正する
- [x] コミットする

## 拡張（将来）

- 下書きプレビューは、エージェントが未保存の候補を確認したくなった時点で個別に仕様化する。
- 複数時刻の一括取得・コンタクトシートは、単一フレームの利用実績を見てから `roadmap.md` へ計画を落とす。
