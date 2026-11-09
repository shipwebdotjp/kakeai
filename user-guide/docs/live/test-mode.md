---
sidebar_position: 5
title: テストモードでリハーサルする
---

# テストモードでリハーサルする

テストモードは、YouTube に接続せず、Live Run に指定した fixture のコメントでライブ全体をリハーサルするモードです。コメントの供給元だけを差し替え、フィルター、コメント分析、ディレクター、TTS、ステージ、コンソールは本番と同じものを使います。

## Run のコメントソースを fixture にする

Kakeai の Live Run 作成画面で、コメントソースに **fixture** を選びます。既存の JSON ファイルを指定するか、コメントを直接入力します。

- 指定した fixture は Run 作成時に `<runDir>/fixtures/comments.json` へコピーされます。
- Run はコピーした fixture の SHA-256 を固定し、実行中に元ファイルが変わっても影響を受けません。
- パッケージや Live Program は書き換えません。

Kakeai から起動すると、Run 設定と control token が自動で渡されます。手動で起動する場合は、Run 画面に表示される Run 設定 JSON を `--run-config` に指定してください。

```sh
npm run live -- \
  --package /tmp/live-package-v2 \
  --run-config /tmp/live-run/run-config.json \
  --config /path/to/live-config.json
```

fixture を使うかどうかは Run 設定の `source.kind` だけで決まります。

テストモードでも、生成レスには設定ファイルの TTS と LLM を使います。LLM は fixture の Run に限り `mode: "external"` も使えます。実 YouTube のコメントを外部 LLM へ送る経路はありません。

## fixture の形式

`fixtures/comments.json` は、コメントの配列です。

```json
[
  {
    "atMs": 30000,
    "author": "みかん",
    "text": "こんにちは！"
  },
  {
    "atMs": 70000,
    "author": "質問さん",
    "text": "なぜこの出来事が起きたのですか？",
    "kind": "normal"
  }
]
```

| 項目 | 内容 |
| --- | --- |
| `atMs` | ショー開始からの相対時刻（ミリ秒） |
| `author` | 表示名 |
| `text` | コメント本文 |
| `kind` | `normal`、`superchat`、`member`。省略時は `normal` |

fixture には、通常のコメント、質問、URL、スパム、個人情報、長文、絵文字、攻撃的なコメントなどを入れておくと、フィルターとコメントコーナーの確認になります。`docs/live/examples/comments-10m.json` と `comments-30m.json` を参考にしてください。

## リハーサルの確認項目

1. ステージを OBS またはブラウザで開き、`pre_show` が表示される
2. コンソールで「開始」を押し、オープニングの準備済み Cue が流れる
3. 字幕・キャラクター・カード・素材が切り替わる
4. コメントコーナーで、危険なコメントがブロックされ、通常コメントが表示される
5. コメント一覧からピンを刺し、AI 候補より先に拾われる
6. 生成レスが TTS 付きで流れ、コンソールの「生成レス」に字幕・読み上げ・表情が表示される
7. 生成中の編集・キャンセル・再生成、準備完了後の削除・並べ替えを試す
8. 停止・再開・安全モード・終了を試す
9. クロージングの後に `post_show` が表示される
10. 実行ディレクトリの `events.jsonl`、`cues.jsonl`、`generated-text.jsonl` を確認する

## 停止と後片付け

- ライブアプリは `Ctrl+C` で停止します。Kakeai の Run 画面から停止することもできます。
- 実行ディレクトリは `<dataDir>/runs/<runId>/` に作られます。テスト用の音声やログが不要になったら、実行ディレクトリを削除してください。
- fixture の Run では YouTube の API は呼びません。API キーや OAuth トークンがなくても起動できます。

## テストモードで確認できないこと

- YouTube の実コメントの取得、クォータ消費、OAuth の失効
- 実際の視聴者によるコメントの増減
- OBS からの音声経路（アプリ内では確認できません）

これらは [OBS の設定](./obs.md) と、実配信前の非公開ライブで確認してください。
