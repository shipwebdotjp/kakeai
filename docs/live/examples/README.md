# ライブ配信のサンプル

10分版と30分版の Show Profile、テストモード用のコメント fixture です。`profile` の `lineId` / `sceneId` / キャラクター ID は、Kakeai 上に作るデモ Work に合わせてください。

## デモ Work の作り方

1. Kakeai で `ja-JP` の Work を作る。
2. キャラクターを 2 体追加し、ID を `char-left` / `char-right` にする（ID はエージェント操作または保存済み JSON で確認する）。
3. 各キャラクターに外観（`expression: normal`）と声プロファイルを割り当てる。左右それぞれ 1 話者にする。
4. 次の Scene / 行を用意する。

| 用途 | Scene ID | 行 ID |
| --- | --- | --- |
| ニュース1の素材カード専用 Scene | `scene-material-1` | - |
| ニュース1のセリフ | `scene-news-1` | `line-news-1-1`, `line-news-1-2`, `line-news-1-3` |
| ニュース2の素材カード専用 Scene | `scene-material-2` | - |
| ニュース2のセリフ | `scene-news-2` | `line-news-2-1`, `line-news-2-2`, `line-news-2-3` |
| ニュース3のセリフ | `scene-news-3` | `line-news-3-1`, `line-news-3-2` |

素材カードにする Scene は、セリフ・立ち絵状態・Scene 範囲の音声キューを持たない単一 Scene にしてください。v1 では nested Composition、動画ゲート、`character.standing` を含む Scene は素材カードにできません。

5. 各行に字幕・読み上げ・話者を設定する。音声は Audio Take を割り当てても、未割り当てのまま TTS に任せてもよい。
6. `show-10m.json` または `show-30m.json` の `lineId` / `sceneId` を、実際の ID に合わせる。`show.characters` も実際のキャラクター ID に合わせる。
7. テストモードでは `commentSource.kind` が `fixture` になっている。`npm run live -- --test`（P2以降）はこの fixture を使う。

## 書き出し

```sh
npm run live:export -- \
  --work <workId> \
  --script-version <scriptVersionId> \
  --profile docs/live/examples/show-10m.json \
  --out /tmp/live-package-10m
```

`--out` は存在しないディレクトリを指定する。`test.fixture` はプロファイルファイルからの相対パスとして CLI が読み、パッケージの `fixtures/comments.json` に書き出す。

## fixture の内容

- `comments-10m.json`: 通常、質問、URL、長文、個人情報、絵文字、攻撃、スパムを含む。
- `comments-30m.json`: 10分版に加えて、2つ目・3つ目のコーナー用のコメントを含む。

fixture はテスト専用であり、実在の視聴者データではない。実 YouTube のコメントを外部 LLM へ送らないこと。
