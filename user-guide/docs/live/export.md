---
sidebar_position: 2
title: ライブパッケージを書き出す
---

# ライブパッケージを書き出す

ライブ配信アプリで使う**ライブパッケージ**を、Kakeai の Work と ScriptVersion から書き出します。書き出しには Kakeai API の `live_export` Job を使います。ライブ実行時に Kakeai の起動は不要です。

## 必要なもの

- Kakeai API が起動していること（既定: `http://127.0.0.1:4317`）
- 保存済みの ScriptVersion
- ライブ用の Show Profile（JSON）。`--auto-profile` を使う場合は不要
- 存在しない出力先ディレクトリ

Show Profile の例は `docs/live/examples/` にあります。`lineId`、`sceneId`、キャラクター ID は、実際の Work に合わせてください。

## 最初の1本を自動生成する

Show Profile をまだ持っていない場合は、Work と ScriptVersion から下書きを生成できます。

```sh
npm run live:export -- \
  --work <workId> \
  --script-version <scriptVersionId> \
  --auto-profile \
  --save-profile live/ai-news/profile.json \
  --out /tmp/live-package-1
```

生成内容だけ確認する場合:

```sh
npm run live:export -- \
  --work <workId> \
  --script-version <scriptVersionId> \
  --auto-profile \
  --save-profile live/ai-news/profile.json \
  --dry-run
```

`--auto-profile` は `intro` Scene をオープニング、`point` Scene を本編、`outro` Scene をクロージングにし、セリフのない Scene を素材として紐づけます。コメントコーナーは各本編の後に置き、最後の本編だけは省きます。`--no-comments` で無効にできます。`--title` で `show.title` を上書きできます。

生成結果には summary と warnings が出ます。opening / closing の placeholder、素材にできなかった Scene、話者のない行などは warning を確認してください。保存したプロファイルは通常の Show Profile なので、そのまま編集できます。`--auto-profile` では `--save-profile` が必須です（`--dry-run` を除く）。同じ保存先に再生成するときは `--force` を付けてください。

## 2本目以降

Work を複製した場合は、行 ID と Scene ID が維持されるため、前回のプロファイルをそのまま使えます。プロファイルの `show.title` だけを新しい Work タイトルに合わせて更新してください。

```sh
npm run live:export -- \
  --work <newWorkId> \
  --script-version <newScriptVersionId> \
  --profile live/ai-news/profile.json \
  --out /tmp/live-package-2
```

行を追加・削除・分割した場合は、`scriptCues` と `segments` の参照を更新してください。`show.title` はステージの `pre_show` に表示されます。

## 書き出し

```sh
npm run live:export -- \
  --work <workId> \
  --script-version <scriptVersionId> \
  --profile docs/live/examples/show-10m.json \
  --out /tmp/live-package-10m
```

| オプション | 内容 |
| --- | --- |
| `--work` | Work ID |
| `--script-version` | ScriptVersion ID |
| `--profile` | Show Profile の JSON |
| `--auto-profile` | Work と ScriptVersion から Show Profile を生成する |
| `--save-profile` | 生成した Show Profile の保存先（`--auto-profile` と併用） |
| `--title` | 生成する `show.title` を上書きする |
| `--no-comments` | コメントコーナーを生成しない |
| `--dry-run` | 生成と summary 表示だけを行い、書き出さない |
| `--force` | `--save-profile` の既存ファイルを上書きする |
| `--out` | 出力先。存在しないディレクトリを指定する |
| `--timeout-ms` | Job の待ち時間（既定: 30分） |
| `--interval-ms` | Job のポーリング間隔（既定: 1秒） |

API の接続先は環境変数 `KAKEAI_API_URL` で変更できます。

成功すると、標準出力に次の JSON が出ます。

```json
{
  "jobId": "job_...",
  "packagePath": "/tmp/live-package-10m",
  "packageId": "livepkg-...",
  "manifestSha256": "...",
  "fileCount": 12,
  "preparedCueCount": 8,
  "warnings": []
}
```

失敗したときは標準エラーに、失敗したキュー・Voice Profile・素材の情報が出ます。

## 出力されるもの

- `manifest.json`: 全ファイルの SHA-256、サイズ、mediaType、尺、寸法、無音フラグ、フォント診断、声のスナップショット
- `show.json`: 解決済みのキュー、素材カード、コメントポリシー
- `characters.json`: キャラクターの外観、顔レイヤー、表情、声
- `theme.css`: テーマの CSS 変数とフォントスタック
- `audio/prepared/`: 準備済み音声（既存の Audio Take または TTS）
- `media/`: キャラクター画像、顔レイヤー、参照音声
- `materials/`: 素材カード（PNG / HTML / 無音 MP4）
- `fixtures/comments.json`: テストモード用のコメント（Show Profile にある場合）

`manifest.json` は自分自身を `files` に含めません。パッケージは書き出し後に変更しません。

## 注意

- 出力先は既存のディレクトリを上書きしません。存在しないディレクトリを指定してください。
- 書き出し中に TTS のテスト合成と準備済み音声の生成を行います。TTS エンジンが起動していることを確認してください。
- 参照音声を使う Voice Profile は、参照音声がパッケージにコピーされます。接続先や API キーはパッケージに含まれません。
- 素材カードにする Scene は、セリフ・立ち絵状態・Scene 範囲の音声キューを持たない単一 Scene にしてください。nested Composition、動画ゲート、`character.standing` は v1 では使えません。
- 実行中の Job は `kakeai-agent job.cancel <jobId>` で協調キャンセルできます（現在のキューが終わってから停止します）。

## 次のステップ

- [ライブ設定と YouTube の接続](./setup.md)
- [テストモードでリハーサルする](./test-mode.md)
- [OBS にステージを設定する](./obs.md)
