# セリフゲート動画再生仕様

## 目的と境界

この文書は、Narration Segment の開始をゲートとして、video Asset の再生・静止・埋め込み音声を制御する **Video Gate Playback** を定める。動画が台詞より早く次の指定時点へ到達したときだけフレームを保持し、台詞が早いときは動画を止めず等速で再生し続ける。

VisualCue、Narration Segment、Audio Take の正本契約は [../mvp/content-schema.md](../mvp/content-schema.md)、Composite Visual Template と Nested Visual は [../composite-visuals/spec.md](../composite-visuals/spec.md)、動画ループは [../media-loop/spec.md](../media-loop/spec.md)、インサートSceneの映像・音声は [../timeline-inserts/spec.md](../timeline-inserts/spec.md) を正とする。この文書はそれらを拡張する。用語は [../../CONTEXT.md](../../CONTEXT.md) を正とする。

対象は、動画を参照できる全ての直接メディア入力と `NestedVisual.kind = "media"` である。従って、背景、カード、端末画面、サイトモックアップなど、親テンプレートのレイアウトを変えずに同じ再生規則を使える。CompositionVersion、画像、AudioCue、動画の速度変更・逆再生は対象外とする。

通常の動画Cueは従来どおり連続・無音で再生する。Video Gate Playback とその音声は、利用者が明示的に設定したvideo Assetだけに適用する。会話を止めて映像と音声を一体で見せる Insert Scene の意味・既定・BGM抑制は変えない。

## 共通メディア入力

動画を参照する直接メディア入力と `NestedVisual.kind = "media"` は、任意の `videoPlayback` を持てる。これは親VisualTemplate固有の表現ではなく、video Asset の時間的な扱いを表す共通入力である。

```json
{
  "kind": "media",
  "assetId": "asset-demo-video",
  "fit": "cover",
  "videoPlayback": {
    "mode": "gated",
    "sourceEndMs": 9800,
    "gates": [
      {
        "narrationSegmentId": "line-point-1-1",
        "sourceMs": 0,
        "audio": { "enabled": true, "gainDb": -9, "fadeInMs": 120, "fadeOutMs": 180 }
      },
      {
        "narrationSegmentId": "line-point-1-2",
        "sourceMs": 2800,
        "audio": { "enabled": false }
      },
      {
        "narrationSegmentId": "line-point-1-3",
        "sourceMs": 6100,
        "audio": { "enabled": true, "gainDb": -12 }
      }
    ]
  }
}
```

`videoPlayback` がないときは既存の連続再生規則を使う。`media.full-bleed@1` の既存 `trimStartMs` / `trimEndMs` と、`media.full-bleed@1`／`media.card@1` の既存 `loop` はそのまま連続再生にだけ適用する。`mode: "gated"` はこれらと併用できない。ゲートの先頭 `sourceMs` が実質的な再生開始点となり、`sourceEndMs` を省略したときは素材の確定尺が終点となる。

この追加は、既存入力を再解釈しない任意フィールドの追加である。既存の `schemaVersion: 1` を維持し、テンプレート版も上げない。

## Video Gate の契約

`videoPlayback` は当面、次の判別値だけを受け入れる。

```ts
type VideoPlayback = {
  mode: "gated";
  sourceEndMs?: positiveInt;
  gates: readonly [VideoGate, ...VideoGate[]];
};

type VideoGate = {
  narrationSegmentId: string;
  sourceMs: nonNegativeInt;
  audio?: VideoGateAudio;
};

type VideoGateAudio =
  | { enabled: false }
  | {
      enabled: true;
      gainDb?: number;       // -60..+12、既定 0
      fadeInMs?: nonNegativeInt;
      fadeOutMs?: nonNegativeInt;
    };
```

`VideoGate` は「指定したNarration Segmentが始まるまで、video playheadが `sourceMs` を通過することを許可しない」編集意図である。素材時刻は元video Assetの先頭からのミリ秒であり、フレーム番号を正本JSONへ保存しない。

### 検証

- 対象Assetは `ready` な `kind: "video"` であり、確定した `durationMs` を持つ。
- `sourceEndMs` は省略時の素材尺を含め、`0 < sourceEndMs <= Asset.durationMs` を満たす。
- Gateは1件以上必要で、各 `sourceMs` は `0 <= sourceMs < sourceEndMs` を満たす。
- Gateの `narrationSegmentId` は親Cueと同じScene内にあり、登録順・解決開始時刻とも厳密に昇順である。`sourceMs` も厳密に昇順とする。
- 各GateのNarration Segment開始時刻は親Cueの実効表示窓 `[start, end)` に入る。`range: "lines"` のCueでは、Gateはそのlines範囲内だけを参照できる。
- `enabled: true` のAudioで `fadeInMs + fadeOutMs` は、そのGateから次Gate（最後は `sourceEndMs`）までのsource区間を超えてはならない。
- `loop`、`trimStartMs`、`trimEndMs` と `videoPlayback` は同じメディア参照で併用できない。切替時に編集UIは連続再生用の値を消去する。

画像またはCompositionを選択したNested Visual、削除済み・未readyなAsset、Cue範囲外または順序不正なGateは保存・ドラフトプレビュー・レンダー投入時に拒否する。Audioを有効にしたvideo Assetに音声ストリームがない場合は、映像は再生し音声は出さず、既存のInsert Sceneと同じく警告を返す。

## 再生規則

Cueの実効表示窓を `[T0, T1)`、GateをNarration Segment開始時刻順に `G1 ... Gn`、各source時刻を `S1 ... Sn` とする。

1. Cueが `T0` で表示されるとき、映像は `S1` のフレームを表示し、`G1` のNarration Segmentが始まるまで静止する。音声は出さない。
2. `G1` が始まると、playheadは `S1` から等速で進む。
3. `i < n` のとき、`Gi+1` が始まる前にplayheadが `Si+1` へ到達したら、`Si+1` のフレームを保持して待つ。`Gi+1` が始まると保持を解除する。
4. `Gi+1` が先に始まった場合、`Si+1` は既に通過可能なので、videoは停止もシークもせず等速再生を続ける。
5. `sourceEndMs` に到達した後は、その最終フレームをCue終端 `T1` まで保持する。Cueが非表示になると映像・音声とも停止する。

この規則はNarration Segmentの開始を動画の**上限ゲート**にするものであり、動画をその開始時刻へ強制シークしたり、再生速度を変えたりしない。Narration GapはNarration SegmentではないためGateにはできない。

## Gate区間の埋め込み音声

各Gateの `audio` は、当該Gateのsource区間 `[Si, S(i+1))`（最後は `[Sn, sourceEndMs)`）でvideoが実際に**進んでいる間**だけ適用する。`audio` の省略は `{ "enabled": false }` と同じである。

- `enabled: true` はvideo Assetに含まれる音声ストリームを映像と同じsource時刻から再生する。
- Gateで映像を保持している間、埋め込み音声も必ず無音にする。静止画のまま音だけを流す編集意図は、明示的なAudioCueで表す。
- `gainDb` は当該source区間だけのゲインである。`fadeInMs` と `fadeOutMs` は実際の再生時間を基準に区間の両端で適用し、保持時間を含めない。
- Audio設定が変わるGateを、videoがGate開始前に通過できる場合は、そのsource時刻で次の設定へ切り替える。Gate開始後に到達した場合も同じsource時刻で切り替える。
- 複数のvideo Cueが同時に音声を有効にした場合は、既存のミックスと同様に重ねる。v1ではナレーションまたは作品全体BGMを自動ダッキングしない。

Insert Sceneだけが持つ `embeddedAudio` と `embeddedAudioGainDb` は、Scene全体で動画を再生しBGMを抑制する別の編集意図である。Video Gate Playbackはそれらを置き換えず、Insert Sceneの主動画には設定できない。

## コンパイル、プレビュー、レンダー

コンパイラは、Cueの解決済みライン開始時刻とVideo Gateから、連続再生区間・静止区間・音声区間を持つ一つの `VideoPlaybackPlan` を導出する。プレビューとレンダーは同じPlanを使う。

- 連続再生区間は、source開始位置とタイムライン上の開始・終了を明示したvideoセグメントとして出力する。
- 静止区間は、到達したsource時刻のデコード済みフレームを表示する。レンダリング用のCFR入力から最寄りフレームを解決するが、そのフレーム番号は派生物であり正本JSONには保存しない。
- 動画要素の実時間 `pause()` / `play()` への依存、wall clock、レンダー時だけ異なるシーク規則を持ち込まない。フレーム抽出・静止フレーム・音声フェードはPlanから決定的に導出する。
- Render Job snapshotは通常どおり解決済み正本JSON、使用Asset/Renditionとその尺を固定する。後からAudio Takeを差し替えてライン開始時刻が変わった場合、別のScriptVersionをレンダーする。

## 編集UI

Cueの素材選択の直後に、共通の **動画再生** パネルを置く。`MediaPicker` が選択したAssetがreadyなvideoで確定尺を持つときだけ表示し、画像・Compositionでは表示しない。初期状態は従来の連続・無音再生であり、利用者が「セリフゲート再生」を有効にしたときだけGate編集を表示する。

- Gate一覧は、親Cueの実効表示窓に入るNarration Segmentだけを候補にする。行の表示名と解決済み開始時刻、source時刻（ms）を編集・並べ替え・削除できる。
- Gateごとに音声を出すか、音量(dB)、フェードイン／アウト(ms)を設定できる。音声ストリームがないvideoでは有効化を警告する。
- 直接素材入力とNested Media入力は同じVideo Playback編集部品を使う。親テンプレートが全画面、カード、端末枠、サイトモックアップであっても操作と保存構造を変えない。
- 動画を画像へ差し替える、Nested MediaをCompositionへ切り替える、またはGateモードを解除する操作は、保存対象の `videoPlayback` を削除する。無効な再生設定を隠したまま保存してはならない。
- Gateの静止・通過・音声の有効区間は、ドラフトプレビューとCue Map上で識別できる。Cue Mapは編集用ナビゲーションであり、Gateを独立のVisualCueやtrackとして保存しない。

## 受け入れ条件

- 同じvideo Assetを全画面、カード、Nested Mediaのいずれにも置き、同一のGate規則でプレビューとMP4へ出力できる。
- 各Gateで、動画が早く到達したときだけ指定フレームを保持し、Narration Segmentが早いときは映像が止まらない。
- Gateの最初と途中で、Cue表示前の静止、台詞前の保持、台詞後の通過、source終端の保持を正しく扱う。
- Gate区間ごとの音声有効／無効、ゲイン、フェードが映像の実際の進行と同期し、保持中に音だけが鳴らない。
- 画像、Composition、範囲外のNarration Segment、順序不正・範囲外のsource時刻、loop／trimとの併用を保存時に拒否または正規化し、既存動画Cueの意味を変えない。
- Audio Take変更後に再解決したライン時刻で、プレビューとRender Jobが同じVideoPlaybackPlanを使う。

## 非目標

- 逆再生、再生速度変更、巻き戻し、source時刻が非単調なGate、ゲート再生中のloop。
- 単語・音素単位の音声アラインメント、Narration GapへのGate、任意時刻の手動pause/resume。
- 静止映像の上でvideoの埋め込み音声だけを継続すること。
- BGMまたはナレーションへの自動ダッキング、音声波形編集、videoの埋め込み音声を別Assetとして恒久保存すること。
- CompositionVersion、画像、任意HTMLへVideo Gate Playbackを適用すること。
