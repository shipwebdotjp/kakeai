---
sidebar_position: 2
title: ライブパッケージを書き出す
---

# ライブパッケージを書き出す

ライブ配信アプリで使う**ライブパッケージ**を書き出します。書き出し元は、Kakeai で作成して版を確定した **Live Program Version** だけです。Work や Script Version は指定しません。書き出しには Kakeai API の `live_export` Job を使い、ライブ実行時に Kakeai の起動は不要です。

## 必要なもの

- Kakeai API が起動していること（既定: `http://127.0.0.1:4317`）
- 版を確定済みの Live Program Version
- 存在しない出力先ディレクトリ

Live Program は Kakeai の「ライブプログラム」画面で作成します。フォーマットを選び、セグメント、Cue、カード、素材、CutIn、キャストを編集してから版を確定してください。

## 書き出す

```sh
npm run live:export -- \
  --program-version <programVersionId> \
  --out /tmp/live-package-v2
```

テスト用コメントをパッケージに同梱する場合:

```sh
npm run live:export -- \
  --program-version <programVersionId> \
  --fixture comments.json \
  --out /tmp/live-package-v2
```

`--fixture` はパッケージへ fixture を同梱しますが、実行時のコメントソースは Live Run の設定が決めます。実配信とリハーサルで同じ版を使い分けるには、[ライブ Run を書き出して起動する](./runs.md) で Run のコメントソースを選んでください。

| オプション | 内容 |
| --- | --- |
| `--program-version` | Live Program Version ID（必須） |
| `--fixture` | テスト用コメント JSON |
| `--out` | 出力先。存在しないディレクトリを指定する |
| `--timeout-ms` | Job の待ち時間（既定: 30分） |
| `--interval-ms` | Job のポーリング間隔（既定: 1秒） |

API の接続先は環境変数 `KAKEAI_API_URL` で変更できます。

成功すると、標準出力に次の JSON が出ます。

```json
{
  "jobId": "job_...",
  "packagePath": "/tmp/live-package-v2",
  "packageId": "livepkg-...",
  "manifestSha256": "...",
  "fileCount": 12,
  "preparedCueCount": 8,
  "warnings": []
}
```

失敗したときは標準エラーに、失敗した Cue・Voice Profile・素材の情報が出ます。`preparedCueCount` は準備済み Cue だけを数え、CutIn は含みません。

## 中央ビジュアルと素材

Live Program の Cue と Segment は、中央スロットに表示する `visual` を1つだけ持ちます。

- `{ "kind": "card", "cardId": "...", "stateId": "..." }`: ネイティブカードの状態を表示する。
- `{ "kind": "material", "materialId": "..." }`: 取り込んだ Live Material を表示する。
- `null`: 中央スロットを隠す。
- 未指定: Segment の既定 `visual` を継承する。

カードと素材を同時に指定する表現はありません。Cue は1回の再生に対応するため、同じ Cue ID を複数の Segment から参照しないでください。

Live Material は取り込み時に **PNG / HTML / MP4** の出力形式を選びます。PNG と HTML は 4 秒の静止カード、MP4 は指定した表示時間（既定 4 秒、最大 30 秒）の無音動画として書き出されます。形式と表示時間は取り込み時に固定され、あとから変更する場合は取り込み直してください。

## コーナーの区切りに動画を挿入する（CutIn）

`cutIns[]` と `cut_in` セグメントで、コーナーの合間に短い動画（**CutIn**）を挿入できます。動画は素材ライブラリの **ready な動画 Asset** を指定します。尺は入力せず、書き出し時に動画を probe した結果を使います。

- `cut_in` セグメントは `targetDurationMs`、`cues`、`visual` を持ちません。
- ブラウザでそのまま再生できない動画は、書き出し時に H.264/AAC の MP4 へ正規化されます。
- 参照された CutIn だけがパッケージに含まれます。
- CutIn は全画面で再生され、キャラクター・字幕・中央ビジュアル・コメントは隠れます。
- 音声ありの CutIn は program ステージだけが再生し、コンソールのプレビューはミュートされます。

## 出力されるもの

- `manifest.json`: 全ファイルの SHA-256、サイズ、mediaType、尺、寸法、無音フラグ、フォント診断、声のスナップショット。`packageSchemaVersion: 2` と Live Program Version の `source` を持つ
- `show.json`: 解決済みの Cue、カード、カード画像、素材カード、CutIn、コメントポリシー。`schemaVersion: 2`。`commentSource`、`test.fixture`、`startAt` は持たない
- `characters.json`: キャラクターの外観、顔レイヤー、表情、声
- `theme.css`: テーマの CSS 変数とフォントスタック
- `audio/prepared/`: 準備済み音声（既存の Audio Take または TTS）
- `media/`: キャラクター画像、顔レイヤー、参照音声、CutIn の MP4
- `materials/`: 素材カード（PNG / HTML / MP4）。HTML が参照する画像は `media/assets/` にコピーされます
- `cards/`: カード画像
- `fixtures/comments.json`: `--fixture` を指定した場合のテスト用コメント

`manifest.json` は自分自身を `files` に含めません。パッケージは書き出し後に変更しません。

## 注意

- 出力先は既存のディレクトリを上書きしません。存在しないディレクトリを指定してください。
- 書き出し中に TTS のテスト合成と準備済み音声の生成を行います。TTS エンジンが起動していることを確認してください。
- 参照音声を使う Voice Profile は、参照音声がパッケージにコピーされます。接続先や API キーはパッケージに含まれません。
- CutIn に使う動画は ready で、尺が確定している必要があります。Asset が見つからない・取り込み中・失敗済み・動画以外の場合、probe や正規化に失敗した場合は書き出しが失敗します。
- 実行中の Job は `kakeai-agent job.cancel <jobId>` で協調キャンセルできます。

## 次のステップ

- [ライブ設定と YouTube の接続](./setup.md)
- [ライブ Run を書き出して起動する](./runs.md)
- [テストモードでリハーサルする](./test-mode.md)
- [OBS にステージを設定する](./obs.md)
