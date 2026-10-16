# Composition Library

Composition Library は、AI（HyperFrames）が作成・公開した全画面モーション（Composition）を、作品をまたいで再利用するためのライブラリです。

## 確認する

画面右上の「コンポジション」を開くと、登録されている Composition の一覧が表示されます。

- 一覧には各 Composition の名前・runtime ID・draft の状態・公開バージョン数が並びます。項目を押すと選択され、詳細が表示されます。
- 詳細には draft の entrypoint と、公開バージョンの一覧（版番号・バージョンID・bundle ハッシュ・entrypoint・公開日時）が表示されます。
- Composition の作成・更新・公開（Publish）は AI が行います。Web UI には HTML の直接編集や公開ボタンはありません。編集内容は draft に入り、公開して初めて台本から参照できる不変の CompositionVersion になります。

## 台本で使う

1. 作品の編集画面で、対象シーンの Cue に **コンポジション背景（全面）**（`composition.full-bleed@1`）を追加します。
2. 入力欄のドロップダウンから、公開済みの CompositionVersion を選びます。

制約:

- **レイヤー** は背景のみです。**表示区間** は Scene 全体・セリフ区間・オフセット（ミリ秒指定）から選べます。
- 同じ CompositionVersion は、1 つの台本（ScriptVersion）内で 1 回だけ参照できます。
- Composition の尺（公開時の再生時間）より表示区間が長い場合、Composition の終わりで表示が打ち切られます（最後の絵を止めて表示し続けたり、繰り返したりはしません）。
- Scene 間のクロスフェードで必要になる表示時間が Composition の尺を超えると、保存時とレンダー開始時にエラーになります。Composition を長くするか、クロスフェードを短くしてください。
- 公開バージョンは不変です。AI が修正しても、既存の台本が参照する版は変わりません。新しい版を使いたいときは、台本のバージョンIDを差し替えて保存します。

> ドロップダウンに目的のバージョンが無い場合は、AI がまだ公開していないか、公開に失敗しています。公開時には 1920×1080・有限尺・無音・HyperFrames lint エラーなしなどが検証されます。
