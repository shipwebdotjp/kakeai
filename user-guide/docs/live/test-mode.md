---
sidebar_position: 4
title: テストモードでリハーサルする
---

# テストモードでリハーサルする

テストモードは、YouTube に接続せず、パッケージに含まれた fixture のコメントでライブ全体をリハーサルするモードです。コメントの供給元だけを差し替え、フィルター、コメント分析、ディレクター、TTS、ステージ、コンソールは本番と同じものを使います。

## テスト用の Show Profile を書き出す

Show Profile に `commentSource.kind: "fixture"` と `test.fixture` を指定します。`docs/live/examples/show-10m.json` と `show-30m.json` は、テスト用の設定を含んでいます。

```json
{
  "commentSource": { "kind": "fixture" },
  "test": { "fixture": "comments-10m.json" }
}
```

`test.fixture` は Show Profile ファイルからの相対パスです。`npm run live:export` は fixture を読み、パッケージの `fixtures/comments.json` に書き出します。

```sh
npm run live:export -- \
  --work <workId> \
  --script-version <scriptVersionId> \
  --profile docs/live/examples/show-10m.json \
  --out /tmp/live-package-10m
```

:::note[実 YouTube 用の Show Profile でテストする場合]
`--test` はコメントソースを fixture に上書きしますが、fixture 本体はパッケージに含まれている必要があります。実配信用の Show Profile にも `test.fixture` を書いてから書き出すか、テスト用の別プロファイルを用意してください。fixture がない場合、コメントは 0 件になり、コメントコーナーはスキップされます。
:::

## 起動する

```sh
npm run live -- \
  --package /tmp/live-package-10m \
  --test \
  --config /path/to/live-config.json
```

`--test` を付けると、Show Profile の `commentSource` が `youtube` でも fixture が使われます。`--test` を付けない場合も、パッケージの `commentSource.kind` が `fixture` なら fixture が使われます。

テストモードでも、生成レスには設定ファイルの TTS と LLM を使います。LLM はテストモードに限り `mode: "external"` も使えます。実 YouTube のコメントを外部 LLM へ送る経路はありません。

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
2. コンソールで「開始」を押し、オープニングの準備済みキューが流れる
3. 字幕・キャラクター・素材カードが切り替わる
4. コメントコーナーで、危険なコメントがブロックされ、通常コメントが表示される
5. コメント一覧からピンを刺し、AI 候補より先に拾われる
6. 生成レスが TTS 付きで流れ、コンソールの「生成レス」に字幕・読み上げ・表情が表示される
7. 生成中の編集・キャンセル・再生成、準備完了後の削除・並べ替えを試す
8. 停止・再開・安全モード・終了を試す
9. クロージングの後に `post_show` が表示される
10. 実行ディレクトリの `events.jsonl`、`cues.jsonl`、`generated-text.jsonl` を確認する

## 停止と後片付け

- ライブアプリは `Ctrl+C` で停止します。
- 実行ディレクトリは `<dataDir>/runs/<runId>/` に作られます。テスト用の音声やログが不要になったら、実行ディレクトリを削除してください。
- テストモードでも YouTube の API は呼びません。OAuth トークンがなくても起動できます。

## テストモードで確認できないこと

- YouTube の実コメントの取得、クォータ消費、OAuth の失効
- 実際の視聴者によるコメントの増減
- OBS からの音声経路（アプリ内では確認できません）

これらは [OBS の設定](./obs.md) と、実配信前の非公開ライブで確認してください。
