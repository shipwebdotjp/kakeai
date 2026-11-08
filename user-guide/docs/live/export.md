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

## Cueごとに素材を切り替える

`scriptCues` の `materialId` で、そのCueだけ中央の素材カードを切り替えられます。`materialId` は `materials[]` にある素材IDを指定します。

```jsonc
{
  "id": "cue-news-1-2",
  "lineId": "line-news-1-2",
  "materialId": "material-chart"
}
```

- 未指定: そのCueが属するSegmentの `material` を使います。
- 文字列: そのCueだけ指定した素材を表示します。
- `null`: Segment既定も無効にし、中央素材を隠します。

1つのCueは1回の再生に対応します。同じCue IDを複数のSegmentから参照したり、同じSegment内で重複させたりしないでください。素材カードはCueの切り替え時に読み込むため、最初の表示が一瞬空白になることがあります。

## コーナーの区切りに動画を挿入する（CutIn）

`cutIns[]` と `cut_in` セグメントで、コーナーの合間に短い動画（**CutIn**）を挿入できます。動画は素材ライブラリの **ready な動画Asset** を指定します。尺は入力せず、書き出し時に動画をprobeした結果を使います。

```jsonc
{
  "segments": [
    {
      "id": "seg-news",
      "kind": "script",
      "label": "ニュース",
      "targetDurationMs": 480000,
      "cues": ["cue-news-1"]
    },
    {
      "id": "cut-to-comments",
      "kind": "cut_in",
      "label": "コメントコーナーへ",
      "cutInId": "jingle-comments"
    },
    {
      "id": "seg-comments",
      "kind": "comment",
      "label": "コメント",
      "targetDurationMs": 300000
    }
  ],
  "cutIns": [
    {
      "id": "jingle-comments",
      "assetId": "asset-video-jingle"
    }
  ]
}
```

- `cut_in` セグメントは `targetDurationMs`、`cues`、`material` を持ちません。
- `assetId` には ready な動画Assetを指定します。Assetが存在しない・取り込み中・失敗済み・動画以外の場合は、書き出し前にエラーになります。
- ブラウザでそのまま再生できない動画（H.264/AAC以外、可変フレームレート、回転あり、MP4以外のコンテナ）は、書き出し時にH.264/AACのMP4へ正規化されます。
- 尺は入力しません。書き出し時にパッケージのMP4をprobeした結果を正本とし、`show.json` の `cutIns[]` と `manifest.json` に反映します。DB上の尺と50ms以上ずれる場合や16:9以外の場合は警告が出ますが、probe結果を採用します。
- 参照されたCutInだけがパッケージに含まれます。`cutIns[]` にあっても `cut_in` セグメントから参照されていないものは書き出されません。
- 音声は任意です。音声ありのCutInは program ステージだけが再生し、コンソールのプレビューはミュートされます。素材カードは従来どおり無音です。
- 同じ `cutInId` を複数の区切りで再利用できます。
- CutInは全画面で再生され、キャラクター・字幕・素材カード・コメントは隠れます。
- 書き出し後の `show.json` には、参照されたCutInだけが `cutIns[]` として追加されます。`manifest.json` では `kind: "cut-in"`、`mediaType: "video/mp4"` のファイルとして記録されます。CutInを使わない場合は `cutIns` を書きません。

:::note[CutInを使うパッケージ]
CutInを使うパッケージは、CutInに対応したライブアプリで実行してください。CutInを使わないパッケージは従来のアプリでも読み込めます。
:::

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

失敗したときは標準エラーに、失敗したキュー・Voice Profile・素材の情報が出ます。`preparedCueCount` は準備済みCueだけを数え、CutInは含みません。CutInの本数は `show.json` の `cutIns[]` で確認してください。

## 出力されるもの

- `manifest.json`: 全ファイルの SHA-256、サイズ、mediaType、尺、寸法、無音フラグ、CutIn の `kind: "cut-in"`、フォント診断、声のスナップショット
- `show.json`: 解決済みのキュー、素材カード、CutIn、コメントポリシー
- `characters.json`: キャラクターの外観、顔レイヤー、表情、声
- `theme.css`: テーマの CSS 変数とフォントスタック
- `audio/prepared/`: 準備済み音声（既存の Audio Take または TTS）
- `media/`: キャラクター画像、顔レイヤー、参照音声、CutInのMP4
- `materials/`: 素材カード（PNG / HTML / 無音 MP4）
- `fixtures/comments.json`: テストモード用のコメント（Show Profile にある場合）

`manifest.json` は自分自身を `files` に含めません。パッケージは書き出し後に変更しません。

## 注意

- 出力先は既存のディレクトリを上書きしません。存在しないディレクトリを指定してください。
- 書き出し中に TTS のテスト合成と準備済み音声の生成を行います。TTS エンジンが起動していることを確認してください。
- 参照音声を使う Voice Profile は、参照音声がパッケージにコピーされます。接続先や API キーはパッケージに含まれません。
- 素材カードにする Scene は、セリフ・立ち絵状態・Scene 範囲の音声キューを持たない単一 Scene にしてください。nested Composition、動画ゲート、`character.standing` は v1 では使えません。
- CutInに使う動画は ready で、尺が確定している必要があります。書き出し時に音声・尺・コーデックを検証します。Assetが見つからない・取り込み中・失敗済み・動画以外の場合、probeや正規化に失敗した場合、尺や動画ストリームを取得できない場合は、書き出しが失敗します。書き出し後の `manifest.json` には `kind: "cut-in"` のMP4が含まれます。
- 実行中の Job は `kakeai-agent job.cancel <jobId>` で協調キャンセルできます（現在のキューが終わってから停止します）。

## 次のステップ

- [ライブ設定と YouTube の接続](./setup.md)
- [テストモードでリハーサルする](./test-mode.md)
- [OBS にステージを設定する](./obs.md)
