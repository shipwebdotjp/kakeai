# 字幕エクスポート仕様

## 目的と境界

この文書は、保存済み ScriptVersion から YouTube へそのまま取り込める SubRip（`.srt`）字幕ファイルを生成・ダウンロードする機能の正とする。ContentDocument の構造は [../mvp/content-schema.md](../mvp/content-schema.md)、HTTP 契約は [../mvp/api-contract.md](../mvp/api-contract.md) を正とし、この文書はそれらへの字幕固有の追加を定める。

- 字幕はレンダー（MP4）とは独立に生成する。MP4 のレンダーを待たず、いつでも保存済みの版から取り出せる。
- 生成した字幕ファイルは Job の出力として保存しない。履歴に残さず、ダウンロードのたびに正本から作り直す。[`Artifact` の定義](../mvp/spec.md)（Job が生成した出力ファイル）は変えない。
- 対象は保存済みの版だけとする。未保存の編集中ドラフトからは生成しない。

## 生成規則

- タイミング解決はレンダーと同じ `resolveTimeline`（`@kakeai/video`）を使う。Scene の `auto` / `fixed`、`SCENE_PADDING_MS`、無音ラインの `SILENT_CAPTION_DURATION_MS` を含め、映像の焼き込み字幕と同一の開始・終了時刻とする。
- 1ラインを1キューとし、`NarrationSegment.captionText`（読み上げ用の `speechText` ではない）を本文にする。登録順に `1` から連番を振る。話者名は含めない。作品設定 `caption.showSpeakerName` が `true` でも SRT は名前なしのままとし、話者名タブは焼き込み専用とする（[ADR 0094](../adr/0094-caption-speaker-label-responsibility.md)）。
- 時刻形式は `HH:MM:SS,mmm --> HH:MM:SS,mmm` とする。ミリ秒未満は切り捨てる。
- 本文の CRLF / CR は LF に正規化し、各行の前後空白を除去したうえで空行を落として結合する（キューの区切り `\n\n` や空白のみの行との衝突を避けるため）。本文が空のラインと、割当尺が0のラインはキューを作らず、連番を詰める。焼き込み字幕と同じく `trim` 後の空本文は表示しない。
- 解決不能な入力（固定尺の選択音声合計超過など）はレンダー投入時と同じ検証とし、422 `RENDER_INPUT_INVALID` で issues を返す。

## HTTP

- `GET /api/v1/script-versions/:scriptVersionId/subtitles` は `200` で SRT バイト列を返す。
  - `Content-Type: application/x-subrip; charset=utf-8`
  - `Content-Disposition: attachment`（ファイル名は Work タイトル由来の `.srt`、空題は `subtitles.srt`、パス区切り等の危険文字を除去し最大80文字（コードポイント数））
  - `X-Content-Type-Options: nosniff`、`Cache-Control: private, max-age=0, must-revalidate`
- 保護は既存の全リクエスト共通ガード（loopback・same-origin）で足り、メディアセッション Cookie は要求しない。失敗は JSON エラー契約で返す（存在しない版は 404 `RESOURCE_NOT_FOUND`）。

## Agent Access

- `script.subtitles` は同じ生成経路（`buildSrt` と `resolveTimeline`）を呼び、`{ scriptVersionId, filename, mimeType, byteSize, srt }` を返す。Artifact・Job・版を作らない（[ADR 0103](../adr/0103-agent-subtitles-and-artifact-path.md)）。

## UI

- 作品編集画面のレンダー欄に「字幕をダウンロード」リンクを置き、現在の保存済み版の字幕を即時ダウンロードする。MP4 レンダーの実行状態に連動しない。
