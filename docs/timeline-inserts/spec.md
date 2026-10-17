# セリフ間・Scene音声・インサートScene 仕様

## 目的と境界

この文書は、会話の自然な間、Scene単位の非ナレーション音声、動画を会話の途中で再生するインサートSceneを定める。実装は必ずここで定める順に進める。台本の正本JSON全般は [../mvp/content-schema.md](../mvp/content-schema.md)、既存のVisual Cueは [../composite-visuals/spec.md](../composite-visuals/spec.md)、Scene間トランジションは [../editor/spec.md](../editor/spec.md) を正とする。

対象は次の三つである。

1. **セリフ前の間**: 特定のNarration Segmentの直前に、字幕・発話・立ち絵の発話演出がない時間を置く。
2. **Scene音声**: Narration Segmentに属さない音声Assetを、Scene全体に配置する。
3. **インサートScene**: 会話を中断して動画を映像・埋め込み音声ごと再生し、その後に会話へ戻る。

任意時刻への音声配置、音声波形タイムライン、音声のトリム、再生速度、逆再生、任意の音声オートメーションは対象外とする。`VisualCue.range: offset` は映像の表示範囲であり、音声やNarration Segmentの開始時刻をずらす機能にはしない。

## 共通原則

- Narration Segmentは発話と字幕の単位であり、汎用音源を挿入するための代用品にはしない。
- `AudioCue` は明示的な音声配置、インサートSceneの動画埋め込み音声は動画Assetから導出する音声配置である。後者のために利用者へ別Audio Assetの抽出・アップロードを要求しない。
- 通常の `media.full-bleed@1` / `media.card@1` の動画Cueは、従来どおり無音である。動画の埋め込み音声を自動再生するのはインサートSceneだけとし、既存の背景動画やカード動画の意味を変えない。
- プレビューとレンダーは同じ解決タイムラインと同じ音声ミックス規則を使う。

## R1: セリフ前の間 (`gapBeforeMs`)

`NarrationSegment` に任意の `gapBeforeMs: nonNegativeInt` を追加する。省略時は `0` とし、`0` は保存時にも省略できる。既存の有効JSONの解釈を変えない加算的拡張なので、これだけでは `schemaVersion` を上げない。

`gapBeforeMs` は当該Segmentの**直前**の無音区間である。この区間には次を置かない。

- 当該Segmentの字幕
- 当該SegmentのAudio Take
- 話者に対応する立ち絵のバウンド、口パクその他の発話演出

先頭Segmentにも設定できる。その場合、auto Sceneでは既存の先頭パディングの後、fixed SceneではScene先頭の後に間を置く。

### タイムライン解決

auto Sceneでは、先頭パディング `500ms` の後に、登録順で各Segmentの `gapBeforeMs`、続けてSegment本体の尺を配置する。音声ありSegmentは選択Audio Takeの尺、音声なしSegmentは既存の `silentCaptionDurationMs = 2500` を本体尺とする。最後に末尾パディング `500ms` を置く。

fixed Sceneでは、選択Audio Takeの合計を `A`、全Segmentのgap合計を `G`、音声なしSegment数を `N`、Scene尺を `D` とする。

- `A + G > D` は `RENDER_INPUT_INVALID` とする。
- `N > 0` のとき、残り `D - A - G` を既存規則どおり音声なしSegmentへ均等配分する。
- `N = 0` のとき、残り `D - A - G` はScene末尾の無音区間とする。

`lines` rangeはSegment本体だけを指し、直前のgapを含めない。`scene` rangeはgapを含む。これにより、セリフに追随するCueや字幕は間に現れず、Scene全体の背景だけは継続する。

### 編集UIと診断

各セリフカードに「このセリフの前の間（ms）」を置く。既定値は0で、未入力は0として扱う。解決済みタイムラインはgapも別区間として表示し、プレビューのセリフジャンプはSegment本体の開始位置へ移動する。TTSの入力・生成対象はspeechTextだけであり、gapを読み上げや音声ファイルへ含めない。

## R2: Scene音声

既存の `AudioCue` の `{ kind: "scene", sceneId }` 範囲を編集UIで扱えるようにする。これはSceneの開始から終了まで有効で、Cueごとに次を編集する。

- 音声Asset
- role: `bgm` / `sfx` / `program`
- `gainDb`
- `loop`

`program` は、録音、素材の補足音、外部映像と別に提供された音声など、BGMでも短い効果音でもない通常の音源を表す。roleは音源ファイルの種類ではなく、編集意図と将来のミックス方針の分類である。

Scene AudioCueはScene先頭から再生する。loopがfalseなら音源終端またはScene終端の早い方で停止し、trueならScene終端まで繰り返す。複数Cueは重ねてミックスする。R2では開始オフセット、フェード、ダッキングをAudioCue個別には持たない。

作品全体BGMとScene AudioCueは通常どおり重ねてミックスする。ただしR3のインサートSceneだけは、動画の埋め込み音声を優先するため別規則を適用する。

## R3: インサートScene

`explanation-scenes@1` のScene列は `intro → (point | insert)* → outro` とする。`insert` は会話を一時停止して素材を見せ聴かせるSceneであり、要点を表す `point` や単なる背景動画とは別のkindである。

### 構造

insert Sceneは次を満たす。

- `timing` は `fixed` とする。
- `lines` は空配列とする。字幕と話者発話は持たない。
- 1件の主動画Cueを持つ。主動画Cueは `media.full-bleed@1`、`layer: background`、`range: { kind: "scene" }` であり、readyなvideo Assetを参照する。
- `insert` 固有の設定は主動画CueのID、`embeddedAudio: true | false`、任意の `embeddedAudioGainDb`（dB、既定0・0は省略可）を持つ。新規作成時は `embeddedAudio: true`、ゲインは0とする。動画のトリムとループは主動画Cueの `media.full-bleed@1` 入力で持つ。
- standing Cueは持てない。初期UIは主動画Cue以外のVisual Cueを追加しない。

主動画CueのIDを明示参照することで、映像指定をSceneの型付きスロットへ重複保存せず、既存のVisual Cue契約を正本とする。

### 尺と映像

主動画Cueは `media.full-bleed@1` の任意入力 `trimStartMs` / `trimEndMs` でソース動画の使用区間を指定でき、`loop` で使用区間を繰り返せる。映像指定は主動画Cueが正本であり、Sceneへは重複保存しない。

ソース動画の確定尺を `S`、`trimStartMs = t0`（既定0）、`trimEndMs = t1`（既定`S`）とし、使用区間の尺を `L = t1 - t0` とする。`0 ≤ t0 < t1 ≤ S` を保存・プレビュー・レンダーで検証する。動画尺が不明なAssetは主動画に選べない。

Scene尺は次を満たす。

- `loop` なし: `scene.durationMs === L`（トリムなしなら `L = S`）。
- `loop` あり: `scene.durationMs >= L`。使用区間をScene尺まで繰り返す。

映像は `data-media-start = t0` を指定し、ループ時は使用区間 `L` ごとの `<video>` セグメントを並べる。動画の使用区間と埋め込み音声の抽出区間は同じ `t0` / `L` を使い、映像と音声を同期させる。

Sceneの前後には既存のScene Transitionを使える。新規insert Sceneの既定transitionはcutとする。

### 埋め込み音声とミックス

`embeddedAudio: true` のinsert Sceneは、主動画Assetの埋め込み音声ストリームを使用区間だけ、映像と同じ時間軸で再生する。任意の `embeddedAudioGainDb`（dB、既定0）で音量を調整でき、映像・音声のどちらにも同じ使用区間が適用される。レンダー実装は必要に応じて音声Renditionを導出してよいが、利用者が別Assetを管理する必要はない。

動画に音声ストリームがない場合、Sceneは無音で再生し、編集画面と保存時診断でその事実を示す。`embeddedAudio: false` は、映像だけを見せたい明示的な無音指定である。

作品全体BGMは、`embeddedAudio: true` のinsert Scene区間では自動的にミュートする。Scene境界では200msのフェードアウト／フェードインを適用し、動画音声とBGMを重ねない。Scene AudioCueは動画音声と重ねてよく、音量は利用者がCueごとに調整する。

### 編集UI

要点Scene追加とは別に「動画を挿入」を用意する。利用者がreadyな動画を選ぶと、insert Scene、主動画Cue、動画尺、`embeddedAudio: true` を一操作で作成する。画面には動画の音声が有効か、音声ストリームが存在するか、作品全体BGMがこの区間で抑制されることを表示する。

インサートSceneを削除しても、参照された動画Assetや他SceneのCueは削除しない。主動画Cueを差し替えると、その動画の確定尺へScene尺を更新する。主動画Cueの削除、別テンプレートへの変更、またはvideo以外のAssetへの差し替えは、先にinsert Sceneを通常のpoint Sceneへ変換するか、別の主動画Cueを指定するまで禁止する。

## 受け入れ条件

- 任意のセリフの直前に指定したgapだけ、字幕・発話音声・発話演出なしの間を置ける。
- Scene AudioCueをUIで追加・編集・削除し、Sceneの開始から正しい尺でプレビュー・レンダーできる。
- 「動画を挿入」だけで、動画映像と埋め込み音声が同時に始まり、使用区間の尺で終わる。前後のNarration Segmentは再生されない。
- 主動画のトリムとループを指定でき、映像と埋め込み音声が同じ使用区間で再生される。
- 動画に音声がない場合と埋め込み音声を無効にした場合を、無音として識別できる。
- 作品全体BGMは、埋め込み音声が有効なインサートSceneで重ならない。
- 通常の背景・カード動画は、従来どおり無音である。
- 保存済みの既存ScriptVersionは、R1〜R3の追加によって意味を変えない。

## 非目標

- 複数動画をつなぐインサート、動画の速度変更、逆再生。
- インサートScene中のセリフ・字幕・立ち絵。
- AudioCueの任意オフセット、個別フェード、個別ダッキング、波形編集。
- 動画の埋め込み音声を、通常の背景・カード動画へ自動適用すること。
- `media.card@1` の動画トリム（ループは従来どおり）。
