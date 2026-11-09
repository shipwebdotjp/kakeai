# ライブ配信のサンプル fixture

このディレクトリには、Live Run の fixture コメントとして使う JSON だけを置いています。Live Program は Kakeai のライブプログラム画面で作成し、フォーマット、セグメント、Cue、カード、素材、CutIn、キャストを編集して版を確定してください。旧 Show Profile のサンプルは削除しました。

## 使い方

1. Kakeai で Live Format を選び、Live Program を作成する。
2. セグメントと Cue を編集し、版を確定する。
3. Live Run の作成画面で、コメントソースに **fixture** を選ぶ。
4. `comments-10m.json` または `comments-30m.json` を指定する。
5. Run を作成し、アプリを起動してコンソールから番組を開始する。

Run 作成時に fixture は `<runDir>/fixtures/comments.json` へコピーされ、SHA-256 が固定されます。パッケージと Live Program は書き換えません。

## fixture の内容

- `comments-10m.json`: 通常、質問、URL、長文、個人情報、絵文字、攻撃、スパムを含む。
- `comments-30m.json`: 10分版に加えて、2つ目・3つ目のコーナー用のコメントを含む。

fixture はテスト専用であり、実在の視聴者データではありません。実 YouTube のコメントを外部 LLM へ送らないでください。

## 注意

- CutIn を使う場合は、ready な動画 Asset を用意し、Live Program の `cutIns[]` と `cut_in` セグメントに追加します。契約は [../../live-media-playout/spec.md](../../live-media-playout/spec.md) を参照してください。
- fixture のコメント時刻はショー開始からの相対時刻です。Run の `startAt` とは独立しています。
