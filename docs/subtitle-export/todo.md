# 字幕エクスポート実装TODO

[字幕エクスポート仕様](./spec.md) を正とする。上から順に進める。

## フェーズ

### [x] S1 生成と文書

- [x] `packages/video` に `buildSrt` / `formatSrtTimestamp` を追加し、`resolveTimeline` の配置と `captionText` から SRT を生成する
- [x] 生成規則（連番・時刻形式・改行正規化・空本文の除外・固定尺超過の例外）のテストを追加する
- [x] `docs/subtitle-export/spec.md` と本TODO、ADR（オンデマンド同期生成・Artifactにしない判断）を作る
- 完了条件: `npm run typecheck` と `packages/video` の字幕テストが通る。

### [x] S2 API と UI

- [x] `GET /script-versions/:scriptVersionId/subtitles` を追加し、SRT を `attachment` として配信する（Work タイトル由来のファイル名）
- [x] 解決不能な入力は 422 `RENDER_INPUT_INVALID` で issues を返す
- [x] レンダー欄に「字幕をダウンロード」を追加し、現在の保存済み版から即時ダウンロードできる
- [x] [../mvp/api-contract.md](../mvp/api-contract.md) のエンドポイント表と節、ユーザーガイドのレンダー節を更新する
- 完了条件: 保存済み版の字幕をダウンロードでき、YouTube へ取り込める。`npm run typecheck` と `npm test` が通る。
