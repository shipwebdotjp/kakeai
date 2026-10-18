# コンテンツJSONスキーマ

## 目的と境界

この文書は、作品を編集するための正本JSONの契約を定める。HyperFrames Composition HTML、開始・終了フレーム、アプリが出力するMP4は正本ではなく、このJSONと選択済み素材から導出する。外部で作成したMP4はvideo Assetとして参照できるが、編集可能な表現の正本にはしない。

JSONは `ScriptVersion` に保存し、すべてのIDは版をまたいで参照する必要がある間は維持する。素材ファイルのパスはJSONへ埋め込まず、必ず `Asset.id` を参照する。Compositionを使うCueは、HTMLやbundleのパスではなくpublish済みの `CompositionVersion.id` を参照する。

## 構造

```json
{
  "schemaVersion": 1,
  "locale": "ja-JP",
  "template": {
    "id": "explanation-scenes",
    "version": 1
  },
  "visualTheme": {
    "id": "soft-editorial",
    "version": 1
  },
  "speakers": [],
  "characters": [],
  "audioTakes": [],
  "scenes": [],
  "audioCues": []
}
```

- `schemaVersion` は正本JSONの移行用バージョンである。テンプレートのバージョンとは別に管理する。新規作成・保存するDocumentは `1` とする。破壊変更の履歴は [content-schema-history.md](content-schema-history.md) を正とする。
- `visualTheme` は作品の見た目の既定値を固定する参照で、必須とする。MVPでは `soft-editorial@1` のみ。未知の参照は拒否する。詳細は [../visual-themes/spec.md](../visual-themes/spec.md) を正とする。
- `locale` はBCP 47形式で保存する。有効値は `ja-JP` と `en-US`。
- `template` は構造と既定表現を決める。MVPでは `explanation-scenes@1` のみ。

`contentJson` はキー順を安定させたJSON文字列として保存する。JCS正規化や `contentHash` は持たない。スキーマを破壊的に変えるときは `schemaVersion` を上げ、保存済みの版を書き換えずに新しい `ScriptVersion` を作って移行する。

`schemaVersion` は `1` とする。各版の変更内容は [content-schema-history.md](content-schema-history.md) を正とする。`schemaVersion != 1` の読出しは拒否し、移行コードは持たない。保存済みJSONは書き換えず、次回の保存で新しい `ScriptVersion` を作る。読出し時に保存済みJSONやそのハッシュを書き換えてはならない。スキーマを破壊的に変えるときは版を上げ、そのとき移行関数を追加する（[ADR-0061](../adr/0061-template-version-as-reinterpretation-boundary.md)）。VisualCue の `layer`/`order`/`transition`、`NestedVisual`、`Composite Visual Template` の詳細は [../composite-visuals/spec.md](../composite-visuals/spec.md) を正とする。編集画面・テキストモデル・シーン間トランジションの詳細は [../editor/spec.md](../editor/spec.md) を正とする。キャラクター表情の `faceSetId`/`expressionId`、Face Set、`character.standing@1` の詳細は [../face-expression/spec.md](../face-expression/spec.md) を正とする。キャラクターの locale 別声対応の詳細は [../multilingual-voice/spec.md](../multilingual-voice/spec.md) を正とする。

## セリフと音声

`NarrationSegment` は、画面上の字幕と読み上げを分離する。字幕は自然な表記、読み上げは発音を制御する表記である。

```json
{
  "id": "line-1",
  "speakerId": "speaker-narrator",
  "captionText": "動画制作を効率化するには、テンプレート化が重要です。",
  "speechText": "どうがせいさくをこうりつかするには、てんぷれーとかがじゅうようです。",
  "selectedAudioTakeId": null,
  "expressionId": null
}
```

`gapBeforeMs` は任意の非負整数で、当該Segmentの**直前**に置く、字幕・発話・発話演出を伴わない無音区間のミリ秒である。省略時は `0` と解釈し、`0` は保存時にも省略できる。既存の有効JSONの解釈を変えない加算的拡張であり、`schemaVersion` は上げない。解決規則は [../timeline-inserts/spec.md](../timeline-inserts/spec.md) を正とする。

`selectedAudioTakeId` は必須の `string | null` とする。`null` は、このラインに音声を配置せず字幕だけを表示することを表す。JSONではこのキーを省略しない。選択可能な音声は、ScriptVersion直下の `audioTakes` に `NarrationSegment.id` とともに管理する。MVPでは手動アップロードだけを作成し、将来TTSで生成した音声も同じ形で追加する。

`expressionId` は必須の `string | null` とする。`null` は、このラインで表情を切り替えない（`normal` と解釈する）ことを表す。JSONではこのキーを省略しない。`expressionId` は、話者（`Speaker.characterId`）に対応するキャラクターの、そのSceneで有効な Character Appearance が参照する Face Set 内の Expression Preset を指す。`speakerId` が `null` のラインは `expressionId` も `null` に限る。詳細は [../face-expression/spec.md](../face-expression/spec.md) を正とする。

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

- `line`（`NarrationSegment`）とSceneのIDは、同一Workの版をまたいで一意かつ安定とする。編集保存のたびに作り直さない。VisualCueの `range` がラインIDで区間を指し、将来の翻訳・派生WorkはこのIDで対応付ける。新規に採番するIDは短い16進トークンで衝突を避けながら生成し、`line` のIDは所属Sceneの短縮トークンを含む（例: `scene-point-a3f`、`line-a3f-9c2`）。
- `selectedAudioTakeId` がnullでない場合、そのTakeは `audioTakes` に存在し、その `narrationSegmentId` が当該ラインのIDと一致しなければならない。nullのラインはAudioTakeを参照しない。
- `line.speakerId` はnullでない場合 `speakers` に存在し、`speaker.characterId` はnullでない場合 `characters` に存在しなければならない。`character.standing` のVisualCue入力が指す `characterId` と `appearanceId` も `characters` とその `appearances` に存在しなければならない。存在しないIDを参照するライン、話者、VisualCueは拒否する。
- `line.expressionId` はnullでない場合、`line.speakerId` がnullであってはならない。`expressionId` の実在（話者キャラクターの有効な Character Appearance が参照する Face Set 内の Expression Preset）はグローバルライブラリを参照するため `contentJson` のスキーマでは検証できない。保存時に API サービスが解決して検証する（[../face-expression/spec.md](../face-expression/spec.md)）。`characterAppearance.faceSetId` についても同様に、存在と素材の整合を保存時に検証する。
- `AudioTake.durationMs` は参照するreadyなAssetの `durationMs`（正規化Renditionがある場合はその値）と一致させる。尺の正本は取り込み済みAsset側とし、台本側で上書きしない。

## キャラクターと話者

話者（音声上の主体）とキャラクター（画面上の主体）は別に管理する。Speakerは任意でCharacterを参照できるが、両者を同一視しない。

```json
{
  "id": "character-rin",
  "name": "リン",
  "voices": [
    { "locale": "ja-JP", "voiceProfileId": "vp_1" }
  ],
  "appearances": [
    {
      "id": "appearance-rin-smile-front",
      "assetId": "asset-rin-smile-front",
      "expression": "smile",
      "pose": "front",
      "faceSetId": null
    }
  ]
}
```

`voices` は locale 別の声の対応表である。同一キャラクター内の `locale` 重複は拒否する。`characterId` を持つ話者の `Speaker.voiceProfileId` は、document の `locale` に対応する `voices` の値と一致させなければならない。詳細は [../multilingual-voice/spec.md](../multilingual-voice/spec.md) を正とする。

MVPでは立ち絵の表情・ポーズは文字列タグとして保存し、表示は選択した立ち絵Assetに依存する。台詞ごとの表情切替は [../face-expression/spec.md](../face-expression/spec.md) で `faceSetId` と `NarrationSegment.expressionId` を追加し、`character.standing@1` で合成する。`faceSetId` が `null` の外観は表情を切り替えず、ベース画像をそのまま描く。編集画面でCharacterとCharacter Appearanceを手動登録し、各Sceneに `character.standing@1` を左右1体ずつ最大2体選択できる。立ち絵の選択はSpeakerやセリフ音声の選択に暗黙連動させない。ただし描画時は、立ち絵の `characterId` に対応する話者が話すセリフ区間だけ、その立ち絵がゆっくり上下にバウンドする。シーン内での立ち絵切替、口パクは後続フェーズで追加する。

## シーンとVisualCue

Sceneはテンプレート上のまとまりで、`kind` によって並び順と新規生成の意味を持つ。`explanation-scenes@1` は `intro`、0件以上の `point` または `insert`、`outro` をこの順に持つ。新規作品は導入、要点1件、結びで開始する。Sceneは**型付きスロットを持たない**。タイトル・サブタイトル・見出し・本文・結びは、統合テキストテンプレート `text.block@1` のVisualCueとして表現する（[../editor/spec.md](../editor/spec.md)、[ADR-0035](../adr/0035-remove-scene-slots-unify-text-cues.md)）。

`insert` Sceneは会話を一時停止して動画を映像と埋め込み音声ごと再生する。`timing` は `{ "mode": "fixed", "durationMs": <Scene尺> }` に固定し、`lines` は空配列、`mainVisualCueId` で指定する1件の主動画Cueだけを持つ。主動画Cueは `media.full-bleed@1`、`layer: "background"`、`range: { "kind": "scene" }` で、readyなvideo Assetを参照する。`embeddedAudio: true | false` を持ち、新規作成時は `true` とする。任意の `embeddedAudioGainDb`（dB、既定0、0は省略）で埋め込み音声の音量を調整できる。複数動画は持てない。主動画Cueの `trimStartMs` / `trimEndMs` でソース動画の使用区間を、`loop` で使用区間の繰り返しを指定できる。ループなしは `Scene尺 === 使用区間の尺`、ループありは `Scene尺 >= 使用区間の尺` を保存・プレビュー・レンダーで検証する。`embeddedAudio: true` の区間は主動画の埋め込み音声を使用区間だけ映像と同期して再生し、作品全体BGM（`{ "kind": "work" }` のAudioCue）を200msフェード付きで抑制する。音声ストリームを持たない動画は無音で再生し、保存時に警告する。詳細は [../timeline-inserts/spec.md](../timeline-inserts/spec.md) を正とする。

すべてのSceneは必須の `label` を持つ。`label` は映像に描画しない編集用の名称で、`heading` テキストCueとは別物である。空白のみは不可、重複は許可する。初期Sceneは `導入` / `要点 1` / `結び` とする。詳細は [../scene-labels/spec.md](../scene-labels/spec.md) を正とする。

すべてのSceneは必須の `accent` を持つ。`{ kind: "theme", token: "primary" | "secondary" | "tertiary" }`（選択中Visual Themeの既定3色）または `{ kind: "custom", color: "#RRGGBB" }`（自由色。大文字に正規化し、透過色・CSS関数・任意文字列は受け入れない）とする。これはSceneの表示設定であり、VisualCueではない。導入、要点1件、結びには `explanation-scenes@1` が定める既定（`theme.primary`）を入れる。テーマの解決規則は [../visual-themes/spec.md](../visual-themes/spec.md) を正とする。

Sceneの境界演出は、入場するScene側の `scene.transition`（`enter`）で持つ。preset は `cut`（既定・尺0）／`fade`（暗転を挟む）／`crossfade` の有限enumで、尺は `durationMs`。総尺は変えない（[ADR-0036](../adr/0036-scene-transition-owned-by-entering-scene.md)、[../editor/spec.md](../editor/spec.md)）。`D <= min(先行Scene尺, 入場Scene尺)` を保存・レンダー投入前に検証する。テキストは `text.block@1` のVisualCueとして置き、`role` で意味付けする。背景素材はSceneではなくVisualCueで指定する。

```json
{
  "id": "scene-point-1",
  "kind": "point",
  "label": "要点 1",
  "accent": { "kind": "theme", "token": "primary" },
  "transition": {
    "enter": { "preset": "fade", "durationMs": 300 }
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
      "selectedAudioTakeId": "take-line-point-1-1-manual",
      "expressionId": null
    },
    {
      "id": "line-point-1-2",
      "speakerId": "speaker-narrator",
      "captionText": "次に詳細を説明します。",
      "speechText": "つぎにしょうさいをせつめいします。",
      "selectedAudioTakeId": "take-line-point-1-2-manual",
      "expressionId": null
    }
  ],
  "visualCues": [
    {
      "id": "text-point-1-heading",
      "template": { "id": "text.block", "version": 1 },
      "range": { "kind": "scene" },
      "layer": "overlay",
      "order": 0,
      "transition": {
        "enter": { "preset": "fade", "durationMs": 350 },
        "exit": { "preset": "none", "durationMs": 0 }
      },
      "input": {
        "text": "テンプレート化の要点",
        "role": "heading",
        "anchor": "center",
        "verticalAlign": "middle",
        "font": "sans",
        "fontSize": 72,
        "color": "#FFFFFF",
        "decoration": { "bold": true, "italic": false, "outline": false, "shadow": true }
      }
    },
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
      "layer": "background",
      "order": 0,
      "transition": {
        "enter": { "preset": "fade", "durationMs": 350 },
        "exit": { "preset": "none", "durationMs": 0 }
      },
      "input": {
        "assetId": "asset-background-1",
        "fit": "cover"
      }
    }
  ]
}
```

`range` は判別unionとし、表示区間を次のいずれかで指定する。解決後は半開区間 `[start, end)` として扱う。

- `{ "kind": "scene" }`: Scene全体。ラインを持たない導入・結びの背景やタイトルに使う。
- `{ "kind": "lines", "startLineId", "endLineId" }`: 同じScene内のセリフ区間。
- `{ "kind": "offset", "startMs", "endMs" }`: Scene先頭からのミリ秒区間。Scene尺に収まらない区間は表示範囲を切り詰め、窓が空になるときは保存時に `meta.warnings`（`offset_range_out_of_scene`）で返す。

MVPの編集画面は、各Sceneに **Cue一覧** を表示し、Cueの追加・削除・ `layer`・`order`・表示区間・`transition` を編集する。背景・カードは `media.full-bleed@1`・`media.card@1`・`scene.device-frame@1` から選び、画像・動画を素材ピッカーで指定する。Composition Library導入後は、publish済みの全画面・無音CompositionVersionのうちCanvas Profileが `landscape` のものだけを `composition.full-bleed@1` のComposition背景として選べる（`scene` / `lines` / `offset` の全 range と絶対開始時刻に対応し、実効表示窓は `min(range 尺, manifest.durationMs)`）。立ち絵は一覧内の「左」「右」固定2行で `character.standing@1` を左右1体ずつ最大2体編集し、位置はテンプレートが `side` と倍率から正規化座標へ写像し、外端の余白を固定する（左 `x=0.03+0.125×scale` / 右 `x=0.97−0.125×scale` / `y=0.86`）。描画順は `background → card → standing → caption → overlay` で固定する（Scene本文の固定層は廃止し、テキストは `overlay` のCueとして描画する）。ContentDocumentとAPIは複数Cue、`lines`、`offset`、複合ビジュアル（`NestedVisual` を含む `scene.device-frame@1` など）と他の対応VisualTemplateを検証・保持する。編集UIで扱えないCueは保存時に削除または変更してはならない。詳細は [../composite-visuals/spec.md](../composite-visuals/spec.md) と [../composition-library/spec.md](../composition-library/spec.md) を正とする。

Sceneの `timing` は判別unionである。新規の要点Sceneは原則として `auto` を使う。導入・結びはラインを持たないため、テンプレート既定の固定尺を使う。

- `{ "mode": "auto" }`: 音声主導の既定値である。`selectedAudioTakeId` があるラインには参照AudioTakeの `durationMs` を、音声なしラインにはテンプレート既定の `silentCaptionDurationMs = 2500` を順に割り当てる。各ラインの本体の前に、そのラインの `gapBeforeMs` を置く。Scene尺は先頭パディング `500ms` + 全ラインのgap合計 + 全ラインの割当尺 + 末尾パディング `500ms` とする。これらの既定値は `explanation-scenes@1` の契約であり、各SceneのJSONには重複保存しない。
- `{ "mode": "fixed", "durationMs": D }`: 利用者が明示的に尺を指定する例外である。音声ありラインは参照AudioTakeの尺を順に使用する。選択済み音声の合計を `A`、全ラインのgap合計を `G`、音声なしライン数を `N` とし、`A + G > D` は保存・レンダー前に `RENDER_INPUT_INVALID` とする。`N > 0` の場合は残りの `D - A - G` を音声なしラインへ均等配分し、割り切れないミリ秒は登録順に1msずつ配る。`N = 0` かつ `A + G < D` の余りはScene末尾の無音区間とする。

両モードともラインは配列の登録順に連続配置する。編集画面は、算出後のScene尺、各ラインの開始・終了、先頭・末尾パディングまたは余りを表示する。利用者は自由な字幕タイミング編集はできない。ラインを持たないSceneの区間は `kind: "scene"` で指定する。

## VisualTemplate

`VisualTemplate` は、VisualCueから呼び出される再利用可能な表現コンポーネントである。テンプレートごとに入力Zodスキーマを持ち、`input` を検証する。

| VisualTemplate | 入力 | 初期対応 |
| --- | --- | --- |
| `text.block@1` | `text`, `role`(title/subtitle/heading/body/closing/label), 配置`anchor`/`verticalAlign`, `font`, `fontSize`, `color`, `lineHeight?`, `decoration`, `fontFace?`, `surface?` | 対応。Sceneのテキストを表現する（[../editor/spec.md](../editor/spec.md)）。未指定時の既定スタイルはVisual Themeのrole別トークンを使う（[../visual-themes/spec.md](../visual-themes/spec.md)） |
| `media.full-bleed@1` | `assetId`, `fit`, `focalPoint?`, `zoom?`, `loop?`, `trimStartMs?`, `trimEndMs?` | 対応。`loop: true` の動画素材がCueの可視窓より短いとき、素材を窓いっぱいに連続配置してループ再生する（[../media-loop/spec.md](../media-loop/spec.md)）。動画は `trimStartMs` / `trimEndMs` で使用区間を指定でき（開始 < 終了、素材尺以内）、`loop` 時は使用区間を繰り返す。insert Sceneの主動画は埋め込み音声も同じ使用区間で再生する（[../timeline-inserts/spec.md](../timeline-inserts/spec.md)） |
| `composition.full-bleed@1` | `compositionVersionId` | Composition Library導入後に対応。`layer: background` に置き、`scene` / `lines` / `offset` の全 range を許可する。Canvas Profileが `landscape` のversionだけを指定できる（`portrait` は保存・preview・renderで拒否）。同一CompositionVersionは複数配置できる（HyperFramesのnativeなinstance分離）。実効表示窓は `min(range 尺, manifest.durationMs)` で、child 終端で打ち切る（末フレーム保持・ループなし）。Cue transition は実効表示窓内に収め、Scene crossfade で必要窓が child 尺を超える場合は保存・レンダー投入時に拒否する。 |
| `media.card@1` | `assetId`, アスペクト比(16:9/4:3/1:1/3:4/9:16、既定16:9), 見出し、補足文, `focalPoint?`, `zoom?`, `loop?` | 対応。見出しと補足文が両方とも空のときはテキスト枠を描画しない。カード枠内の動画を背景と同じ規則でループ再生する（[../media-loop/spec.md](../media-loop/spec.md)） |
| `character.standing@1` | `characterId`, `appearanceId`, `side`(left/right), 倍率 | 対応。1 Sceneに左右1体ずつ最大2件を編集。発話中の立ち絵はバウンド。[../face-expression/spec.md](../face-expression/spec.md) の表情対応を含み、外観が参照する Face Set のベース＋眉＋目＋口＋前景を合成し、台詞区間ごとに Expression Preset を切り替える。Face Set を持たない外観は単体画像と同じ見た目 |
| `scene.device-frame@1` | `screen`(`NestedVisual`), `frame`(laptop/phone), `backgroundColor?`, `animation?`（preset, durationMs） | 対応。端末枠内に画像・動画、または `kind: "composition"` の CompositionVersion を表示する複合ビジュアル。背景・カードに置ける。screen のCompositionはCanvas Profileが `landscape` / `portrait` のどちらでも置け（phoneは9:16）、fit・zoom・位置で調整する。画面要素の登場アニメーションを追加できる |
| `scene.site-mockup@1` | `variant`, `screen`(`NestedVisual`), `theme?`, `name?`/`handle?`/`url?`/`caption?`, `logo?`, `animation?` | 対応。有名サイト・ブラウザのガワに画像・動画を収める。card/overlay |
| `chart.bar@1` | タイトル、カテゴリ、系列、数値、向き、目盛り、効果 | 対応（[../chart-template/spec.md](../chart-template/spec.md)） |
| `table.simple@1` | 見出し、列定義、行、スタイル、効果 | 対応（[../table-template/spec.md](../table-template/spec.md)） |
| `list.callout@1` | 見出し、ポイント列、行トリガー付き効果 | 対応（[../cue-effects/spec.md](../cue-effects/spec.md)） |
| `stat@1` | 数値、ラベル、補足、書式、トーン、効果 | 対応。大きな数値を行トリガーでカウントする（[../stat-template/spec.md](../stat-template/spec.md)） |
| `flow.diagram@1` | タイトル、ノード、辺、向き、スタイル、効果 | 対応。縦横を `style.orientation` で切替える。行トリガーでノードを強調する（[../flow-template/spec.md](../flow-template/spec.md)） |
| `quote@1` | 引用本文、著者、出典、トーン、スタイル、効果 | 対応。著者・出典付きの引用カードを行トリガーで強調する（[../quote-template/spec.md](../quote-template/spec.md)） |
| `chat.thread@1` | タイトル、メッセージ列（名前・本文・左右・時刻・アイコン）、枠、ステータスバー、効果 | 対応。会話を吹き出しで並べる。`frame` でスマートフォン／ノートPC／デスクトップ／全面を選び、コンテナ相対で同じレイアウトを表示する。`effects` でメッセージ単位のセリフ同期（登場・強調）ができる（[../chat-template/spec.md](../chat-template/spec.md)） |

テンプレート定義は、入力Zodスキーマに加えて `inputFields`（編集画面のフィールド仕様）、`layers`（許可レイヤー）、`transitionPolicy`・`animationPolicy`（許可preset・既定値・最大尺）、`collectAssetRefs`（素材参照走査）を持つ。編集画面は `inputFields` からフォームを生成し、テンプレート追加でエディタのコードを増やさない。入退場と内部アニメーションは有限preset（`none`/`fade`/`slide-*`/`scale-in`/`pulse`）と尺だけで表し、任意CSSやスクリプトを持ち込まない。詳細は [../composite-visuals/spec.md](../composite-visuals/spec.md) を正とする。

テンプレート内部の演出は、Cue Trigger（行区間またはCue窓）と Cue Effect（`appear` / `emphasize` / `value`）の共通単位で表せる。`emphasize` は `style`（`background` / `frame` / `spotlight`）と、任意の `onset`（発火の一発演出。`sweep` / `flash` / `pop` / `marker` / `underline`。`marker`・`underline` は線が走った後、区間末まで残る）を持つ。`value` は数値に限り、区間中で数値をカウントする。Triggerは行IDを参照し、実時刻はコンパイラが音声尺から解決する。targetの束ね方はテンプレート固有で、データ駆動テンプレートは `effects` 配列、著者アイテム型は各アイテムのインラインとする。詳細は [../cue-effects/spec.md](../cue-effects/spec.md) を正とする。

スクリーンショット、写真、イラスト、既にレンダー済みのモーショングラフィックスはAssetを参照する。表・グラフ・フローチャートは画像化する必要はなく、構造化データをVisualTemplateへ渡して描画する。VisualTemplateのコードはアプリ側で管理する信頼済み実装だけとし、利用者または外部AIが生成した任意のHyperFrames／HTMLコードはDocumentに保存または実行しない。例外として、Kakeai管理下でAIが作成し不変bundleとしてpublishしたCompositionVersionは、`composition.full-bleed@1` のID入力、または `NestedVisual` の `kind: "composition"`（端末画面など）を通じてnative nested compositionとして参照できる。CompositionVersionはCanvas Profile（`landscape` = 1920×1080 / `portrait` = 1080×1920）を持ち、`composition.full-bleed@1` は `landscape` だけを受け付ける。将来、生成したPNGや動画をキャッシュする場合も、それは来歴を持つ派生Assetとして扱う。

`VisualTemplate` の版は「保存済みの有効入力を再解釈しない境界」であり、既存の有効データの意味・レイアウト・検証結果を変える場合だけ版を上げる（[ADR-0061](../adr/0061-template-version-as-reinterpretation-boundary.md)）。再解釈を伴わない拡張は同じ版を書き換えてよい。未知の `id@version` は拒否する。参照ゼロの版は削除してよい。

`fit: cover` を使うテンプレートは、任意の正規化 `focalPoint: { x, y }` と任意の拡大率 `zoom`（`0.5〜3`、省略時は等倍 `1`）を受け取る。未指定時は中央 `{ "x": 0.5, "y": 0.5 }` とし、クロップ位置は出力ピクセルではなく正規化座標で指定する。編集画面は `media.full-bleed@1` と `media.card@1` の `focalPoint` と `zoom` を焦点位置コントロールで編集し、中央へ戻すと `focalPoint` を、等倍に戻すと `zoom` を省略する。拡大率はメディアだけに適用し、カードの矩形とテキスト配置は変えない。詳細は [../focal-point/spec.md](../focal-point/spec.md) と [../media-zoom/spec.md](../media-zoom/spec.md) を正とする。

### テキストの制約

テキスト系テンプレートと字幕は、テンプレートごとに最大行数・最小フォントサイズ・自動改行規則を持つ。次は `text.block@1` の `role` 別初期値であり、テンプレート契約の一部として不変に保つ。上限を変える場合は新しいテンプレート版を追加する。

| 対象 | 最大行数 | 1行の目安 | 最小フォントサイズ |
| --- | --- | --- | --- |
| `role: title` | 2 | 全角18文字 | 48px |
| `role: subtitle` | 2 | 全角24文字 | 32px |
| `role: heading` | 2 | 全角16文字 | 40px |
| `role: body` | 6 | 全角28文字 | 28px |
| `role: closing` | 2 | 全角20文字 | 28px |
| `captionText` | 2 | 全角20文字 | 28px |
| `chat.thread@1` の `body` | 4 | 全角16文字 | 28px |

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

これにより、将来9:16テンプレートを追加しても制作上の意図を保ったまま配置規則を変えられる。`character.standing@1` は `side` と倍率を正規化座標へ写像する。半幅 `0.125×scale` を用い、左 `x=0.03+0.125×scale` / 右 `x=0.97−0.125×scale` / `y=0.86` とする（外端の余白を一定に保つ）。各テンプレートのアニメーションと既定z-indexはテンプレート側で管理し、MVPの正本JSONには持ち込まない。

BGMはAudioCueとしてScene外またはScene単位で配置する。音声Asset自体を「BGM型」に固定せず、同じ音声素材をナレーション以外の用途にも利用可能にする。`AudioCue.range` も `kind` による判別union（`work` / `scene`）とする。`AudioCue.role` は `bgm` / `sfx` / `program` とし、音源ファイルの種類ではなく編集意図と将来のミックス方針の分類である。作品全体BGMは `role: "bgm"` と `{ "kind": "work" }` のAudioCueを1件だけ編集し、既定値は `gainDb: -18`、`loop: true` とする。Scene範囲のAudioCue（`{ "kind": "scene" }`）は編集画面で一覧・追加・削除・素材選択・role・gain・loopを編集でき、Sceneの開始から終了まで重ねてミックスする。開始オフセット・フェード・ダッキングは持たない。`embeddedAudio: true` のinsert Scene区間では、作品全体BGMを200msフェード付きで自動的に抑制し、Scene AudioCueは埋め込み音声と重ねてよい。詳細は [../timeline-inserts/spec.md](../timeline-inserts/spec.md) を正とする。

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

- `packages/contracts` にこのJSONのZodスキーマとVisualTemplate入力スキーマを置く。Sceneは必須の `label`（空白のみ拒否）、必須の `accent`（`theme` tokenまたは大文字 `#RRGGBB` の `custom`）、`timing: z.discriminatedUnion("mode", ...)`、任意の `transition` を持ち、NarrationSegmentの `selectedAudioTakeId` と `expressionId` は必須の `z.string().nullable()` とする。`expressionId` は `speakerId` が `null` ならば `null` に限る。`CharacterAppearance.faceSetId` も必須の `z.string().nullable()` とする。`Character` は必須の `voices`（`locale` 重複拒否）を持ち、`characterId` を持つ話者の声は document の `locale` に対応する `voices` の値と一致させる。Documentは必須の `visualTheme` を持ち、未知のテーマ参照は拒否する。Sceneは型付きスロットを持たず、`VisualCue.range` は `kind` による判別unionとして定義し、未知の `kind` は拒否する。
- 正本JSONにはローカルパス、フレーム番号、HyperFrames固有のDOM属性やHTMLを保存しない。Compositionを使うCueはpublish済み `CompositionVersion.id` だけを保存する。
- 保存前に、ID一意性（同一Workの版をまたいだ安定ID）・Take参照・readyなAsset参照・publish済みCompositionVersion参照・Sceneのアクセント・`scene.transition` の尺（`D <= min(先行Scene尺, 入場Scene尺)`）を検証する。VisualCueの `range` と各テンプレート入力の効果トリガーが参照する行IDは、同一Sceneに実在することを検証する（`collectLineReferences`）。`composition.full-bleed@1` はbackground層だけに置き、Canvas Profileが `landscape` のversionだけを許可する（同一CompositionVersionの複数配置は許可する。端末画面などへの入れ子参照も再帰的に収集する）。Composition背景の実効表示窓は `min(range 尺, manifest.durationMs)` とし、Cue transition は実効表示窓内に収める。Scene crossfade により必要となる表示窓が child 尺を超える場合は保存・レンダー投入時に拒否する。Assetの尺を必要とする音声配置規則は、保存前とレンダー投入前に検証する。insert Sceneは主動画Cueの存在・テンプレート/層/range・立ち絵Cueや余分なCueの不在を契約で検証し、APIサービスが主動画Assetの `kind: "video"`・`ready`・使用区間の範囲（`0 ≤ trimStartMs < trimEndMs ≤ 素材尺`）とScene尺の規則（ループなし `= 使用区間` / ループあり `>= 使用区間`）を保存・プレビュー・レンダー前に検証する。`embeddedAudio: true` で音声ストリームを持たない動画には警告を返す。`faceSetId` と `expressionId` はグローバルライブラリを参照するため、API サービスが Face Set を解決して、存在・`ready` な画像 Asset・ベース画像との寸法一致・Expression Preset の部位参照を保存時に検証する（[../face-expression/spec.md](../face-expression/spec.md)）。テキスト量の目安超過は拒否せず警告として返す。
- Render Jobには、検証済みの正本JSON、選択AudioTake、使用するレンダー入力（Renditionまたは原本）の参照情報、CompositionVersionのID・bundle hash・manifest、解決済みFace Set、テンプレート版、出力設定を保存する。ワーカーはスナップショットJSONを実行時の信頼済みコンパイラでHTMLとchild file treeへ変換する。ツール更新後の同一MP4再現は要件にしない。
- Composition HTMLは、アプリが管理するVisualTemplateと検証済み入力からだけ生成する。利用者入力や外部AI出力をHTML/JavaScriptとして直接実行しない。Kakeai管理下でAIが作成しpublish済みのCompositionVersionだけは、検証済みmanifestとbundleを用いるnative nested compositionとして実行できる。Asset IDの表示参照への変換はコンパイラに注入する `assetResolver` が担う。
- `contentJson` はキー順を安定させたJSON文字列として保存する。JCS正規化や `contentHash` は持たない。スキーマを破壊的に変えるときは `schemaVersion` を上げ、保存済みの版を書き換えずに新しい `ScriptVersion` を作って移行する。移行関数は実際に版を上げる時点で `packages/contracts` に追加し、先回りして持たない。
