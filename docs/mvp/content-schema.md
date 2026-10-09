# コンテンツJSONスキーマ

## 目的と境界

この文書は、作品を編集するための正本JSONの契約を定める。HyperFrames Composition HTML、開始・終了フレーム、MP4は正本ではなく、このJSONと選択済み素材から導出する。

JSONは `ScriptVersion` に保存し、すべてのIDは版をまたいで参照する必要がある間は維持する。素材ファイルのパスはJSONへ埋め込まず、必ず `Asset.id` を参照する。

## 構造

```json
{
  "schemaVersion": 1,
  "locale": "ja-JP",
  "template": {
    "id": "explanation-scenes",
    "version": 1
  },
  "speakers": [],
  "characters": [],
  "audioTakes": [],
  "scenes": [],
  "audioCues": []
}
```

- `schemaVersion` は正本JSONの移行用バージョンである。テンプレートのバージョンとは別に管理する。MVPが新規作成・保存するDocumentは `1` とする。
- `locale` はBCP 47形式で保存する。MVPの有効値は `ja-JP` のみ。
- `template` は構造と既定表現を決める。MVPでは `explanation-scenes@1` のみ。

`contentJson` はキー順を安定させたJSON文字列として保存する。JCS正規化や `contentHash` は持たない。スキーマを破壊的に変えるときは `schemaVersion` を上げ、保存済みの版を書き換えずに新しい `ScriptVersion` を作って移行する。

`schemaVersion` は `1` から始める。過去に設計上の試行版（v1/v2相当）はあったが保存済みデータは存在しないため、移行コードや旧版の読出し解釈を先回りして実装しない。スキーマを破壊的に変えるときに初めて `schemaVersion` を上げ、その時点で保存済みの版を書き換えずに新しい `ScriptVersion` を作る移行関数を追加する。読出し時に保存済みJSONやそのハッシュを書き換えてはならない。

## セリフと音声

`NarrationSegment` は、画面上の字幕と読み上げを分離する。字幕は自然な表記、読み上げは発音を制御する表記である。

```json
{
  "id": "line-1",
  "speakerId": "speaker-narrator",
  "captionText": "動画制作を効率化するには、テンプレート化が重要です。",
  "speechText": "どうがせいさくをこうりつかするには、てんぷれーとかがじゅうようです。",
  "selectedAudioTakeId": null
}
```

`selectedAudioTakeId` は必須の `string | null` とする。`null` は、このラインに音声を配置せず字幕だけを表示することを表す。JSONではこのキーを省略しない。選択可能な音声は、ScriptVersion直下の `audioTakes` に `NarrationSegment.id` とともに管理する。MVPでは手動アップロードだけを作成し、将来TTSで生成した音声も同じ形で追加する。

```json
{
  "id": "take-line-1-manual",
  "narrationSegmentId": "line-1",
  "source": "manual",
  "assetId": "asset-audio-line-1",
  "durationMs": 3240
}
```

`speakerId` は任意とする。ナレーターが画面に出ない場合でもSpeakerを指定でき、話者が未定の台本下書きも保持できる。

正本JSONは、次を検証済みの不変条件として満たす。衝突すると視覚演出やレンダータイミングが不定になるため、すべて `packages/contracts` のスキーマで強制する。

- `line`（`NarrationSegment`）とSceneのIDは、同一Workの版をまたいで一意かつ安定とする。編集保存のたびに作り直さない。VisualCueの `range` がラインIDで区間を指し、将来の翻訳・派生WorkはこのIDで対応付ける。
- `selectedAudioTakeId` がnullでない場合、そのTakeは `audioTakes` に存在し、その `narrationSegmentId` が当該ラインのIDと一致しなければならない。nullのラインはAudioTakeを参照しない。
- `line.speakerId` はnullでない場合 `speakers` に存在し、`speaker.characterId` はnullでない場合 `characters` に存在しなければならない。`character.standing` のVisualCue入力が指す `characterId` と `appearanceId` も `characters` とその `appearances` に存在しなければならない。存在しないIDを参照するライン、話者、VisualCueは拒否する。
- `AudioTake.durationMs` は参照するreadyなAssetの `durationMs`（正規化Renditionがある場合はその値）と一致させる。尺の正本は取り込み済みAsset側とし、台本側で上書きしない。

## キャラクターと話者

話者（音声上の主体）とキャラクター（画面上の主体）は別に管理する。Speakerは任意でCharacterを参照できるが、両者を同一視しない。

```json
{
  "id": "character-rin",
  "name": "リン",
  "appearances": [
    {
      "id": "appearance-rin-smile-front",
      "assetId": "asset-rin-smile-front",
      "expression": "smile",
      "pose": "front"
    }
  ]
}
```

MVPでは立ち絵の表情・ポーズは文字列タグとして保存し、表示は選択した立ち絵Assetに依存する。表情を自動切替する機能は後続フェーズで追加する。

## シーンとVisualCue

Sceneはテンプレート上のまとまりで、`kind` によって型付きスロットを持つ。`explanation-scenes@1` は `intro`、0件以上の `point`、`outro` をこの順に持つ。新規作品は導入、要点3件、結びで開始する。

- `intro`: `slots.title`、`slots.subtitle`
- `point`: `slots.heading`、`slots.body`
- `outro`: `slots.closing`

すべてのSceneは必須の `accentColor` を持つ。値は大文字に正規化した `#RRGGBB` 形式に限定し、透過色・CSS関数・任意文字列は受け入れない。これはSceneベーステンプレートの表示設定であり、VisualCueではない。新規作品の導入、要点3件、結びには `explanation-scenes@1` が定める既定色を入れる。

スロットはデータであり、Sceneの基本表現はSceneベーステンプレートが既定で描画する。テンプレートは `accentColor` をCSS変数などの安全な表示値として使う。追加のテキストはtext系VisualTemplateをVisualCueとして重ねられる。背景素材はSceneではなくVisualCueで指定する。

```json
{
  "id": "scene-point-1",
  "kind": "point",
  "accentColor": "#2563EB",
  "slots": {
    "heading": "テンプレート化の要点",
    "body": "共通構造を固定すると、素材とセリフの差し替えだけで量産できます。"
  },
  "timing": {
    "mode": "auto"
  },
  "lines": [
    {
      "id": "line-point-1-1",
      "speakerId": "speaker-narrator",
      "captionText": "最初の要点です。",
      "speechText": "さいしょのようてんです。",
      "selectedAudioTakeId": "take-line-point-1-1-manual"
    },
    {
      "id": "line-point-1-2",
      "speakerId": "speaker-narrator",
      "captionText": "次に詳細を説明します。",
      "speechText": "つぎにしょうさいをせつめいします。",
      "selectedAudioTakeId": "take-line-point-1-2-manual"
    }
  ],
  "visualCues": [
    {
      "id": "visual-point-1-bg",
      "template": {
        "id": "media.full-bleed",
        "version": 1
      },
      "range": {
        "kind": "lines",
        "startLineId": "line-point-1-1",
        "endLineId": "line-point-1-2"
      },
      "input": {
        "assetId": "asset-background-1",
        "fit": "cover"
      }
    }
  ]
}
```

`range` は判別unionとし、表示区間を次のいずれかで指定する。

- `{ "kind": "scene" }`: Scene全体。ラインを持たない導入・結びの背景やタイトルに使う。
- `{ "kind": "lines", "startLineId", "endLineId" }`: 同じScene内のセリフ区間。
- `{ "kind": "offset", "startMs", "endMs" }`: Scene先頭からのミリ秒区間。

MVPの編集画面は、各Sceneについて `media.full-bleed@1` と `media.card@1` をそれぞれ最大1件、`{ "kind": "scene" }` で編集する。背景は最背面、カードはその上に表示する。画像・動画のみを選べ、背景・カードを両方指定できる。これは編集UIの範囲であり、ContentDocumentとAPIは複数Cue、`lines`、`offset`、他の対応VisualTemplateを引き続き検証・保持する。編集UIで扱えないCueは保存時に削除または変更してはならない。

Sceneの `timing` は判別unionである。新規の要点Sceneは原則として `auto` を使う。導入・結びはラインを持たないため、テンプレート既定の固定尺を使う。

- `{ "mode": "auto" }`: 音声主導の既定値である。`selectedAudioTakeId` があるラインには参照AudioTakeの `durationMs` を、音声なしラインにはテンプレート既定の `silentCaptionDurationMs = 2500` を順に割り当てる。Scene尺は先頭パディング `500ms` + 全ラインの割当尺 + 末尾パディング `500ms` とする。これらの既定値は `explanation-scenes@1` の契約であり、各SceneのJSONには重複保存しない。
- `{ "mode": "fixed", "durationMs": D }`: 利用者が明示的に尺を指定する例外である。音声ありラインは参照AudioTakeの尺を順に使用する。選択済み音声の合計を `A`、音声なしライン数を `N` とし、`A > D` は保存・レンダー前に `RENDER_INPUT_INVALID` とする。`N > 0` の場合は残りの `D - A` を音声なしラインへ均等配分し、割り切れないミリ秒は登録順に1msずつ配る。`N = 0` かつ `A < D` の余りはScene末尾の無音区間とする。

両モードともラインは配列の登録順に連続配置する。編集画面は、算出後のScene尺、各ラインの開始・終了、先頭・末尾パディングまたは余りを表示する。利用者は自由な字幕タイミング編集はできない。ラインを持たないSceneの区間は `kind: "scene"` で指定する。

## VisualTemplate

`VisualTemplate` は、VisualCueから呼び出される再利用可能な表現コンポーネントである。テンプレートごとに入力Zodスキーマを持ち、`input` を検証する。

| VisualTemplate | 入力 | 初期対応 |
| --- | --- | --- |
| `text.title@1` | `title`, `subtitle`, 配置`anchor` | 対応（導入・結びのスロット描画） |
| `text.body@1` | `heading`, `body` | 対応（要点のスロット描画） |
| `media.full-bleed@1` | `assetId`, `fit`, `focalPoint?` | 対応 |
| `media.card@1` | `assetId`, 見出し、補足文, `focalPoint?` | 対応 |
| `character.standing@1` | `characterId`, `appearanceId`, 正規化座標、倍率 | レンダー対応。編集UIはMVP後 |
| `chart.bar@1` | タイトル、系列、数値、単位 | 将来 |
| `table.simple@1` | 列定義、行、強調セル | 将来 |
| `flow.horizontal@1` | ノード、辺、強調状態 | 将来 |

スクリーンショット、写真、イラスト、既にレンダー済みのモーショングラフィックスはAssetを参照する。表・グラフ・フローチャートは画像化する必要はなく、構造化データをVisualTemplateへ渡して描画する。将来、生成したPNGや動画をキャッシュする場合も、それは来歴を持つ派生Assetとして扱う。

`VisualTemplate` の版は不変とする。`id@version` の意味とレイアウト規約を変える場合は同じ版を書き換えず、新しい版（例 `@2`）を追加する。過去の版の描画コードは原則削除せず、保存済み作品が参照する版を描画し続けられるようにする。ただし、どの保存済みScriptVersionからも参照されていない版は削除してよい。

`fit: cover` を使うテンプレートは、任意の正規化 `focalPoint: { x, y }` を受け取る。未指定時は中央 `{ "x": 0.5, "y": 0.5 }` とし、クロップ位置は出力ピクセルではなく正規化座標で指定する。MVPの編集画面は `focalPoint` を指定せず中央クロップを使い、既存の指定値は保持する。

### テキストの制約

テキスト系テンプレートと字幕は、テンプレートごとに最大行数・最小フォントサイズ・自動改行規則を持つ。次は `explanation-scenes@1` の初期値であり、テンプレート契約の一部として不変に保つ。上限を変える場合は新しいテンプレート版を追加する。

| 対象 | 最大行数 | 1行の目安 | 最小フォントサイズ |
| --- | --- | --- | --- |
| `slots.title` | 2 | 全角18文字 | 48px |
| `slots.subtitle` | 2 | 全角24文字 | 32px |
| `slots.heading` | 2 | 全角16文字 | 40px |
| `slots.body` | 6 | 全角28文字 | 28px |
| `slots.closing` | 2 | 全角20文字 | 28px |
| `captionText` | 2 | 全角20文字 | 28px |

`1行の目安` は自動改行の基準であり、`最小フォントサイズ` を下回らない範囲で収める。収まらない入力は保存を拒否せず、警告（`meta.warnings`）として該当フィールドのJSON Pointerと理由を返す。利用者はプレビューで実際のはみ出しを確認して修正する。描画時に黙って縮小・切り詰めしない。

## レイアウトと音声配置

Characterなど位置を持つテンプレートは、出力ピクセルではなく正規化座標で位置を持つ。

```json
{
  "anchor": "right",
  "x": 0.9,
  "y": 0.85,
  "scale": 0.8
}
```

これにより、将来9:16テンプレートを追加しても制作上の意図を保ったまま配置規則を変えられる。各テンプレートのアニメーションと既定z-indexはテンプレート側で管理し、MVPの正本JSONには持ち込まない。

BGMはAudioCueとしてScene外またはScene単位で配置する。音声Asset自体を「BGM型」に固定せず、同じ音声素材をナレーション以外の用途にも利用可能にする。`AudioCue.range` も `kind` による判別union（`work` / `scene`）とする。MVPの編集画面は `role: "bgm"` と `{ "kind": "work" }` のAudioCueを1件だけ編集し、既定値は `gainDb: -18`、`loop: true` とする。Scene別・複数BGM・SFXの編集はMVP後とし、既存のAudioCue値は保持する。

```json
{
  "id": "audio-bgm-main",
  "role": "bgm",
  "assetId": "asset-bgm-main",
  "range": { "kind": "work" },
  "gainDb": -18,
  "loop": true
}
```

## 実装上のルール

- `packages/contracts` にこのJSONのZodスキーマとVisualTemplate入力スキーマを置く。Sceneは必須の `accentColor: z.string().regex(/^#[0-9A-F]{6}$/)` と `timing: z.discriminatedUnion("mode", ...)` を持ち、NarrationSegmentの `selectedAudioTakeId` は必須の `z.string().nullable()` とする。Sceneの型付きスロットと `VisualCue.range` は `kind` による判別unionとして定義し、未知の `kind` は拒否する。
- 正本JSONにはローカルパス、フレーム番号、HyperFrames固有のDOM属性やHTMLを保存しない。
- 保存前に、ID一意性（同一Workの版をまたいだ安定ID）・Take参照・readyなAsset参照・Sceneのアクセント色・シーン種別ごとのスロットの不変条件を検証する。Assetの尺を必要とする音声配置規則は、保存前とレンダー投入前に検証する。テキスト量の目安超過は拒否せず警告として返す。
- Render Jobには、検証済みの正本JSON、選択AudioTake、使用するレンダー入力（Renditionまたは原本）の参照情報、テンプレート版、出力設定を保存する。ワーカーはスナップショットJSONを実行時の信頼済みコンパイラでHTMLへ変換する。ツール更新後の同一MP4再現は要件にしない。
- Composition HTMLは、アプリが管理するVisualTemplateと検証済み入力からだけ生成する。利用者入力やAI出力をHTML/JavaScriptとして直接実行しない。Asset IDの表示参照への変換はコンパイラに注入する `assetResolver` が担う。
- `contentJson` はキー順を安定させたJSON文字列として保存する。JCS正規化や `contentHash` は持たない。スキーマを破壊的に変えるときは `schemaVersion` を上げ、保存済みの版を書き換えずに新しい `ScriptVersion` を作って移行する。移行関数は実際に版を上げる時点で `packages/contracts` に追加し、先回りして持たない。
