# ライブ配信仕様（AI進行のYouTubeライブ）

Status: accepted. ライブの正本は Live Program と Live Program Version、実行境界はパッケージv2である。旧 Show Profile と v1 パッケージの経路は削除済み（[ADR-0134](../adr/0134-live-program-v2-only.md)）。ライブ台本とライブカードの契約は [../live-program/spec.md](../live-program/spec.md) を正とする。

## 目的と境界

この文書は、Kakeaiで制作した台本・キャラクター・素材・テーマ・声を使い、AIキャラクターが進行するYouTubeライブを、ローカルMac上で実行するための仕様を定める。

- ライブの出力は、OBSでキャプチャするブラウザの**ステージ**である。MP4のレンダーではない。
- ライブの正本は、Live Program と、Kakeaiの既存データ（Theme、Character、Asset、VoiceProfile）である（ADR-0131）。ライブ実行時は、書き出した**ライブパッケージ**だけを読む。
- 既存のコンポジション（Scene・VisualCue・タイムライン）をライブの進行に使わない。ライブは**状態駆動の別ランタイム**である。理由は [ADR-0120](../adr/0120-live-runtime-separate-from-composition.md) を正とする。
- 準備済みキューは Live Program が所有し、`lineId` でScriptVersionを参照しない（ADR-0131）。パッケージは `schemaVersion: 2` だけを持つ。
- 再生はprogramステージ1つがリースを持ち、コンソールのpreviewはミュート・イベント非送信とする。理由は [ADR-0125](../adr/0125-live-program-playback-lease.md) を正とする。
- 素材カードは静止PNG/HTMLまたは短い無音MP4に限定し、コンポジションのタイムラインをライブで再生しない。理由は [ADR-0126](../adr/0126-live-material-cards-static-or-mp4.md) を正とする。
- コーナーの区切りなどに挿入する短い動画（CutIn）は、素材カードの拡張でもCueでもなく、Spine専用の `cut_in` セグメントとして扱う。詳細は [../live-media-playout/spec.md](../live-media-playout/spec.md) と [ADR-0130](../adr/0130-live-cut-in-separate-from-cues-and-materials.md) を正とする。
- TTSの接続設定はライブアプリに置き、パッケージは声のスナップショットと参照音声だけを持つ。理由は [ADR-0127](../adr/0127-live-tts-voice-snapshot-boundary.md) を正とする。
- コメント取得は`liveChatMessages.list`のポーリングを正規経路とし、`streamList`はP0.5のスパイク後に判断する。理由は [ADR-0128](../adr/0128-live-comment-polling-primary.md) を正とする。
- YouTube連携は**読み取り専用**とする。配信の開始・終了、タイトル・サムネイル設定、チャット投稿、モデレーションは人間が行う。理由は [ADR-0121](../adr/0121-youtube-read-only-comment-source.md) を正とする。
- ライブのコメントは**コメントコーナー**で拾う。人間が選んだコメント（人間ピン）を優先し、残りをAI候補が埋める。即時割り込みは行わない。理由は [ADR-0122](../adr/0122-live-comment-corner-human-pin.md) を正とする。
- 実YouTubeでは、コメントの分析と応答生成に**ローカルLLMだけ**を使う。生コメントも要約も外部LLMへ送らない。fixtureテストでは外部LLMを使ってよい。理由は [ADR-0123](../adr/0123-live-youtube-local-llm-only.md) を正とする。
- 対象はローカルの単一利用者、`ja-JP`、30分を目安とするライブである。クラウド配信、複数ユーザー、配信作成、チャット投稿、VOD編集は対象外とする。

既存の台本契約は [../mvp/content-schema.md](../mvp/content-schema.md)、テーマは [../visual-themes/spec.md](../visual-themes/spec.md) と [../theme-customization/spec.md](../theme-customization/spec.md)、キャラクターと表情は [../face-expression/spec.md](../face-expression/spec.md) と [../standing-states/spec.md](../standing-states/spec.md)、TTSは [../tts/spec.md](../tts/spec.md) と [../multilingual-voice/spec.md](../multilingual-voice/spec.md) を正とする。この文書は、それらをライブ用にどう組み合わせるかを定める。

## 用語

用語の正は [CONTEXT.md](../../CONTEXT.md) とする。本書で頻出する用語は次のとおり。

| 用語 | 意味 |
| --- | --- |
| Live Program | 1回のライブ配信の台本。スパイン、Cue、カード、素材、CutIn、コメント・安全・プレイアウトのポリシーを持つ。 |
| Live Program Version | Live Program の不変の版。書き出しと配信開始はこの版を指定する。 |
| ステージ | OBSでキャプチャする1920x1080のブラウザ画面。キャラクター、字幕、素材、コメントカード、フェーズを描画する。 |
| プレイアウト | ライブキューを音声再生に合わせて進める状態機械。タイムラインではない。 |
| ライブCue | ライブの最小出力単位。話者、字幕、読み上げ、表情、中央ビジュアル、コメント、音声を持つ。 |
| PreparedCue | Live Program Version から解決された準備済みCue。`origin`は常に`live`。 |
| programステージ | 再生リースを持ち、音声を再生する唯一のステージ。OBSに出す。 |
| previewステージ | コンソールで状態を確認するための、ミュート・イベント非送信のステージ。 |
| コメントコーナー | 視聴者コメントをまとめて拾う、スパイン上の区間。常時コメントを拾うモードは使わない。 |
| スパイン | ライブの予定されたセグメント順。コンポジションのタイムラインではない。 |
| CutIn | コーナーの区切りなどに挿入する全画面の短い動画。専用のSpineセグメントとして扱い、素材カードやCueとは分ける。 |
| 素材集 | 時間が余ったときや調整に使う追加の話題・ネタ・退避素材。現行では必須ではない。 |
| 人間ピン | オペレーターが次のコメントコーナーで拾うと明示したコメント。AI候補より優先される。 |
| AI候補 | コメント分析役が提示する候補。人間ピンの残り枠を埋める。 |
| コメントソース | コメントを供給する境界。YouTubeライブチャットまたはfixture。 |
| テストモード | fixtureのコメントで、実際のディレクター、TTS、ステージ、コンソールを通す実行。 |
| オペレーターコンソール | 人間がピン、スキップ、停止、編集、ログ確認を行うローカル画面。OBSには出さない。 |
| 安全モード | 生成レスを止め、準備済みの安全なキューだけを流す状態。 |
| ローカルLLM | 実YouTubeのコメント分析と応答生成に使う、同一マシン上のモデル。コメントを外部へ送らない。 |
| 外部LLM | fixtureテストだけに使える外部モデル。実YouTubeのコメントは送らない。 |

## 全体構成

```text
Kakeai（制作・書き出し）
  Work / ScriptVersion / Theme / Character / Asset / VoiceProfile
        │
        ▼
  ライブパッケージ（不変）
        │
        ▼
apps/live（実行）
  package loader ── stage（OBS）
  comment source ── filter / analyst ── director (local LLM) ── playout ── stage
  operator console ── commands / logs
        ▲
        │ 読み取りのみ
YouTube ライブチャット
```

- **Kakeai** は、台本、テーマ、キャラクター、素材、声、TTSアダプタ、準備済み音声、素材カードのコンパイルを担当する。ライブの進行には関与しない。生成レスのTTSは、ライブ側が同じアダプタを直接呼ぶ。
- **apps/live** は、ライブパッケージを読み、コメントを取得し、コメントコーナーを進行し、音声を再生し、ステージとコンソールを提供する。
- **OBS** は、ステージをブラウザソースでキャプチャし、音声を配信に載せる。配信の開始・終了は人間が行う。
- **YouTube** は、コメントの読み取り元である。アプリは書き込まない。
- Kakeaiとapps/liveはDBを共有しない。境界はライブパッケージと、共有するTTSアダプタだけである。

### 実装構成

- `apps/live` はNode + TypeScriptのローカルサーバー。HTTPはExpress、WebSocketは`ws`を使う。パッケージ配信、実行ディレクトリの管理を持つ。
- ステージとコンソールはViteでビルドした静的ページとして配信する。ステージはフレームワーク非依存の軽量ページ、コンソールはReact + Viteとする。
- コメント取得、分析、ディレクター、プレイアウト、ログはサーバー側で動かす。ステージは状態描画と音声再生、コンソールは操作と表示を担当する。
- LLMの接続設定はライブアプリのローカル設定に置く。実YouTubeは`mode: "local"`を強制し、fixtureテストだけ外部LLMを許可する。
- 手動起動は `npm run live -- --package <dir> --run-config <run-config.json> [--port <port>] [--config <file>]` を想定する。ライブの実行にKakeaiの起動は不要とする。
- Kakeaiからの起動は `--run-id`、`--run-dir`、`--control-token-file`、`--run-config` を追加で受け取る。LLM/TTS/YouTube認証情報は従来どおり `--config` のローカル設定だけに置く。

## ライブパッケージ

### 構成

```text
live-package/
  manifest.json
  show.json
  theme.css
  characters.json
  materials/
    material-news-1.png
  cards/
    card-image-1.png
  media/
    characters/
      left-base.png
      left-eye-normal.png
      left-mouth-speaking.png
    assets/
      <sha256>.mp4
    voice/
      ref-a.wav
  audio/
    prepared/
      cue-opening-1.wav
      cue-news-1-1.wav
  fixtures/
    comments.json
```

- `manifest.json` は、`packageSchemaVersion: 2`、Live Program Version の `source`（`programId`、`programVersionId`、文書ハッシュ、解決スナップショットハッシュ、Theme Revision）、作成日時を持つ。
- `show.json` は、`schemaVersion: 2`、スパイン、Cue、カード、素材、CutIn、スピーカー、コメントポリシー、安全設定、プレイアウトを持つ。`commentSource`、`test.fixture`、`show.startAt` は持たず、Live Run の run config で固定する。
- `theme.css` は、解決済みのテーマCSS変数とフォントスタックを持つ。テーマの色・書体・余白・影・角丸を、ステージと素材カードで共有する。
- `characters.json` は、左右のキャラクターの外観画像、顔レイヤー、表情プリセット、立ち位置、声の設定を持つ。
- `materials/*.png` は、取り込んだ Live Material を静止PNGの素材カードとして書き出したものである。
- `media/assets/*.mp4` は、CutInの検証済みMP4である。素材カードの無音MP4とは別の `kind: "cut-in"` を持ち、埋め込み音声を持てる。
- `cards/` は、ネイティブカードの画像Assetを持つ。`show.json` と素材カードからは相対URLで参照する。
- `media/voice/` は、参照音声を使うTTSの音声ファイルを持つ。パッケージには接続設定を入れず、参照音声だけを固定する。
- `audio/prepared/` は、準備済みキューの音声を持つ。既存のAudio Takeがあればそれを使い、なければ書き出し時にTTSで生成する。
- `fixtures/comments.json` は、テストモード用のコメント列を持つ。任意。

パッケージは書き出し後に変更しない。ライブ実行中の生成音声、ログ、編集履歴は、パッケージとは別の**実行ディレクトリ**へ書く。

### manifest.json

`manifest.json`は、パッケージの完全性と再現性を検証するための情報を持つ。

```jsonc
{
  "packageSchemaVersion": 2,
  "exporterVersion": "0.1.0",
  "packageId": "livepkg-...",
  "createdAt": "2026-11-07T12:00:00.000Z",
  "source": {
    "programId": "...",
    "programVersionId": "...",
    "programVersionNumber": 3,
    "programDocumentSha256": "...",
    "resolutionSnapshotSha256": "...",
    "theme": { "id": "...", "version": 3 }
  },
  "cardSchemaVersion": 1,
  "files": [
    {
      "path": "materials/material-news-1.png",
      "sha256": "...",
      "byteSize": 123456,
      "mediaType": "image/png",
      "kind": "material",
      "durationMs": null,
      "width": 1920,
      "height": 1080,
      "hasAudio": false
    },
    {
      "path": "media/assets/<sha256>.mp4",
      "sha256": "...",
      "byteSize": 1234567,
      "mediaType": "video/mp4",
      "kind": "cut-in",
      "durationMs": 4200,
      "width": 1920,
      "height": 1080,
      "hasAudio": true
    }
  ],
  "fonts": [
    { "role": "caption", "family": "...", "found": true, "fallback": "sans-serif" }
  ],
  "voices": [
    {
      "speakerId": "spk-left",
      "characterId": "char-left",
      "adapterId": "voicevox",
      "voiceId": "...",
      "refAudio": "media/voice/ref-a.wav",
      "refAudioSha256": "...",
      "testSynthesis": "ok"
    }
  ]
}
```

- `files`は、`manifest.json`を除くパッケージ内の全ファイルのSHA-256・byteSize・mediaType・種別・尺・寸法・無音フラグを持つ。`manifest.json`自身は自己ハッシュできないため含めない。Loaderは`manifest.json`以外の全ファイルが`files`と一致し、`files`にないファイルが`manifest.json`以外にないことを検証する。
- `kind: "cut-in"` はCutIn専用で、`video/mp4` と `hasAudio: true|false` を持つ。素材カードの `kind: "material"` と `hasAudio: false` は別のまま検証する。
- `fonts`は、テーマのフォント役割ごとの解決可否とfallbackを持つ。不足は既定で警告とし、`required`のフォントだけ停止扱いにできる。
- `voices`は、参照音声を使うVoice Profileの参照音声パスとハッシュを持つ。接続設定は含めない。
- ライブアプリは起動時に、ファイルの欠落・ハッシュ不一致・未対応mediaType・カードの音声混入・CutInのMP4/尺/音声不整合・フォント不足を検証する。ファイル欠落・ハッシュ不一致・未対応mediaType・カードの音声混入・CutInの不整合は停止、フォント不足は警告を既定とする。
- 音声はWAVまたはMP3を許可する。既存Audio Takeは、再生可能なRenditionをコピーするか、書き出し時に正規化する。

### 書き出し

書き出しはKakeai APIの`live_export` Jobとして行う。コマンド、Job、解決とコピーの詳細は[Kakeai側の書き出し](#kakeai側の書き出し)を参照する。

### 素材カード

素材カードは、ライブの中央スロットに表示する視覚素材である。Live Material のスナップショットを**静止PNG**として書き出し、ステージの中央に`img`で表示する。コンポジションのGSAPタイムラインやHyperFrames Playerはライブで動かさない。理由は [ADR-0126](../adr/0126-live-material-cards-static-or-mp4.md) を正とする。

- 素材カードは1920x1080で作り、中央スロットに縮小する。文字やカードの見た目はKakeaiのプレビューと一致する。
- Segment は既定の `visual` を持ち、Cue の `visual` で上書きできる。未指定はSegment既定、`null`は非表示、`card` / `material` はその参照を表示する。カードと素材を同時に指定しない。詳細は [../live-program/spec.md](../live-program/spec.md) を正とする。
- カードは音声を持たない。音声はプレイアウトのキューが担当する。manifestの`hasAudio: false`で検証する。CutInはこの制約の対象外で、専用の`cut-in`種別として埋め込み音声を持てる。
- カードのAsset URLは、HTML文字列の置換ではなく、書き出し時のAsset Resolverでパッケージ相対URLとして生成する。
- カードはKakeaiが生成した信頼済みのものだけを使う。視聴者コメントや外部HTMLをカードとして実行しない。

## Live Run の起動と control

KakeaiはLive Program Versionから書き出したv2パッケージをLive Runとして起動する。Runは `<Kakeai data root>/live-runs/<runId>/` を持ち、次のファイルを置く。

- `run-config.json`: `schemaVersion`、`runId`、`programVersionId`、`package`、`source`（YouTubeまたはfixtureのパスとSHA-256）、`startAt`、`requestedPort`。認証情報やLLM/TTS接続先は含めない。
- `control-token`: launch時に一度だけ生成する制御token。`0600`で書き、DBにはパスだけを残す。
- `fixtures/comments.json`: fixture Runだけが持つ、作成時にコピーしたコメント列。
- `live.log`、`run.json`、`events.jsonl` などの実行ログ。停止後も削除しない。

Run作成時は、パッケージが同じ`programVersionId`の成功した`live_export` Jobの結果（`packageId`、`manifestSha256`、`packagePath`）と一致することを検証する。fixtureは通常ファイルかつ10 MiB以下に限る。`requestedPort`は`1024`〜`65535`で、終了していない別Runが使うポートは拒否する（既定`3010`）。

起動はdetachedで行い、`--run-id`、`--package`、`--port`、`--control-token-file`、`--run-config`、`--run-dir` を渡す。起動は番組開始ではない。番組開始はコンソールで行う。

### control endpoint

| メソッド | パス | 内容 |
| --- | --- | --- |
| `GET` | `/control/status` | `{ ok, runId, ready, stageUrl, consoleUrl, status, phase, showStarted, showEnded, startedAt, failure }` を返す。 |
| `POST` | `/control/stop` | アプリの終了を要求する。`{ ok: true, status: "stopped" }`。 |

- どちらもloopbackのHostだけを受け付ける。`Authorization: Bearer <control-token>` が無い・違う場合は401、非loopbackは403。
- tokenファイルも環境変数も無い手動起動では `/control/*` を404にし、ステージとコンソールは通常どおり動かす。
- `status` は `starting`、`ready`、`running`、`ended`、`stopped`、`failed`。`ready` はアプリ稼働中で番組未開始、`running` は番組開始済みを表す。
- 状態は `showStarted` / `showEnded` と `phase` でも確認できる。token値はログにもDTOにも出さない。

### 再接続と失敗

Kakeaiを再起動しても、既存RunのLive appはそのまま動かす。一覧・詳細の取得時にtokenファイルを使って `/control/status` を読み、`running` / `ended` / `stopped` を反映する。

- プロセスが生きているがcontrolへ接続できない: `failed`（`control_unreachable`）。
- プロセスが終了している: `failed`（`process_exited`）。
- 自動再起動、自動再生、自動的な番組開始は行わない。必要なら新しいRunを作る。
- 停止はcontrolの `/control/stop` を先に呼び、応答しない場合はPIDへSIGTERM、必要ならSIGKILLを送る。ログは残す。

## CutIn

CutInは、コーナーの区切りなどに挿入する短い動画である。Spine上の `cut_in` セグメントとして明示し、ステージの全画面レイヤーで再生する。素材カードの拡張ではなく、Cueでもない。詳細は [../live-media-playout/spec.md](../live-media-playout/spec.md) を正とする。

- 入力は `cutIns[]` の `{ id, assetId }` と、`segments[]` の `{ id, kind: "cut_in", label, cutInId }` で表す。`cut_in` セグメントは `targetDurationMs` を持たない。
- 書き出し後の `cut_in` セグメントの実効尺は `show.cutIns[].durationMs` から導出し、`LiveServerShowMeta.segments[].targetDurationMs` にもその値を使う。入力・出力とも `cut_in` セグメントに `targetDurationMs` を持たせない。
- `assetId` はreadyなvideo Assetを参照する。書き出し時にMP4へ解決し、尺と `hasAudio` はprobe結果を正本にする。
- `cutIns` は複数のセグメントから再利用できる。occurrenceは `segmentId`・`attempt`・`sequence` で識別する。参照されたCutInだけをパッケージに含め、CutInを使わない場合は `show.json` に `cutIns` を書かない。
- 音声は任意とする。素材カードは無音のまま、CutInだけ `hasAudio: true` を許可する。
- 再生は `phase: "cut_in"` と `StageState.cutIn` を使い、通常のCueの `playback` に流用しない。
- 全画面レイヤーでキャラクター・字幕・素材カード・コメント・セグメントラベルを隠す。ループしない。
- programステージだけが埋め込み音声を再生し、previewはミュートし、再生イベントも送らない。
- `cut_in_ended` を受けたら次のSpine要素へ進む。読み込み失敗・watchdogは警告を記録して次へ進み、配信を停止しない。watchdogは尺＋1500ms（最低3000ms）を目安にし、現在のoccurrenceに一致する試行だけを打ち切る。
- pause後は先頭から再開する。再接続・program引継ぎ時は `startedAt` から位置を求めてシークし、尺を過ぎていれば終了を通知する。
- 安全モード中はCutInをスキップする。

## パッケージv2のポリシー

Live Program Version が、コメント、安全、プレイアウト、キャスト、スピーカーを所有する。`show.json` はその解決結果を持ち、外部のプロファイル入力は存在しない。

```jsonc
{
  "commentPolicy": {
    "mode": "corner",
    "freshnessMin": 10,
    "maxCommentsPerCorner": 4,
    "maxHumanPinsPerCorner": 4,
    "maxExtraSlots": 2,
    "allowImmediateInterrupt": false,
    "skipWhenEmpty": true
  },
  "safety": {
    "blockedTopics": [],
    "persona": "親しみやすい解説役",
    "maxResponseChars": 180,
    "maxResponseCues": 2,
    "fallbackCueId": "cue-fallback"
  },
  "playout": {
    "minBufferMs": 10000,
    "maxThinkingMs": 2000,
    "closingReserveMs": 120000,
    "noApprovalDelay": true
  }
}
```

- `commentPolicy.mode` は `corner` だけを実装する。`continuous` と `hybrid` は将来の拡張とする。
- `commentPolicy.allowImmediateInterrupt` は常に `false` とする。台本の途中でコメントを割り込ませない。
- `freshnessMin` は、コメントを拾う鮮度の目安である。`maxCommentsPerCorner`、`maxHumanPinsPerCorner`、`maxExtraSlots` はコーナーの枠を決める。
- `safety.blockedTopics`、`persona`、`maxResponseChars`、`maxResponseCues` は生成レスに適用する。`fallbackCueId` は通常のスパインに属さない専用Cueを指す。
- `playout.minBufferMs` は、常時確保する準備済み音声の長さ（ミリ秒）である。`maxThinkingMs`は、無音の「考え中」を許す上限である。`closingReserveMs`は、クロージングに入るために残す時間である。`noApprovalDelay`は、人間の承認待ちを入れないことを表し、常に`true`とする。
- コメントソース、fixture、`startAt` は Live Run の run config が所有する。`show.json` はこれらを持たない。
- スピーカーは `show.speakers[]` に、話者ID、表示名、左右、キャラクターID、`voice`（`adapterId`、`voiceId`、`speedScale`、`settings`、任意の`refAudio`）を持つ。
- `PreparedCue` は `id`、`origin: "live"`、`speaker`、`caption`、`speech`、`expression`、任意の`visual`、`audio`、`durationMs` を持つ。`sourceLineId`と`materialId`は持たない。
- `show.json` は strict schema で検証し、`commentSource`、`test`、`show.startAt`、`materialId`、`segment.material` が含まれていれば拒否する。

## スパインと素材集

v1の主線はスパイン（`segments`）である。素材集（追加の話題・ネタ・退避素材）は、時間が余ったときのフィラーとして使えるようにするが、v1では必須ではない。スパインが尽きたらクロージングへ進む。素材集の自動選択はロードマップで扱う。CutInは素材集ではなく、`cut_in`セグメントとしてスパインに明示する。

## ステージ

### レイアウト

ステージは1920x1080の固定キャンバスを、OBSのブラウザソースに合わせて拡大縮小する。レスポンシブに再配置しない。

```text
┌──────────────────────────────────────────────┐
│ セグメントラベル                             │
│                                              │
│ [左キャラ]   ┌──────────────────┐   [右キャラ] │
│              │   中央のビジュアル  │              │
│              │ (カード / 素材)     │              │
│              └──────────────────┘              │
│  ┌─ コメント ──────────────┐                  │
│  │ 投稿者 / コメント / 回答中 │                  │
│  └─────────────────────────┘                  │
│  字幕帯（話者名 + 字幕）                      │
└──────────────────────────────────────────────┘
```

- 左・右のキャラクターは、`characters.json`の外観画像と顔レイヤーで描画する。話している側は口パクと軽いバウンド、聞いている側は待機・瞬き・表情を持つ。
- 中央スロットには、ネイティブのLive Cardか素材カードのどちらか一方だけを表示する。素材カードは静止PNGを`img`、短い無音MP4を`video`、静的HTMLをスクリプトなしのsandbox iframeで表示し、1920x1080のカードをスロットに縮小する。動画はミュート・ループとする。`visual: null`のセグメント・Cueでは非表示にする。
- 字幕は下部の帯に表示する。テーマの`caption`トークン、話者名タブ、折返しを使う。
- コメントカードは、コメントコーナーで回答中のコメントを表示する。投稿者名、短縮したコメント、回答中バッジを持つ。コメントカードはv1では後から追加できるが、状態機械には最初から含める。
- セグメントラベルは、現在のセグメント名を小さく表示する。
- 背景は、テーマの`skin`背景（neutralまたはhandmade-paper）を使う。必要ならライブ用の机・スタジオ装飾をCSSで足す。
- programステージは音声を再生し、再生イベントを送る。コンソールのpreviewステージはミュート・イベント非送信とする。
- コンソールに埋め込むプレビューは `/stage?preview=1` を開き、programが未接続でもpreviewとして接続する。programになるのはOBS用に別タブで開く `/stage` だけである。

### フェーズ

ステージは次のフェーズを持つ。

| フェーズ | 内容 |
| --- | --- |
| `pre_show` | 「まもなく始まります」、番組タイトル、カウントダウン、キャラクターの待機。 |
| `opening` | オープニングの準備済みキュー。 |
| `script` | スパインの本編。現在のCueに応じて素材カードを表示する。 |
| `comment` | コメントコーナー。コメントカードを表示する。 |
| `cut_in` | コーナー間などの短い動画。全画面で再生し、通常のキャラクター・字幕・素材は隠す。 |
| `closing` | クロージングの準備済みキュー。 |
| `post_show` | 「本日の配信は終了しました」、お礼、次回予告。 |
| `paused` | 一時停止。音声をフェードアウトし、状態を保持する。 |
| `safe_mode` | 生成レスを止め、準備済みの安全なキューだけを流す。 |
| `error` | 復旧できないエラーの表示。オペレーターに通知する。 |

`pre_show`と`post_show`は別ページにしない。同じステージの状態として扱い、OBSのソースを切り替えない。開始と終了はオペレーターが押す。`startAt`がある場合はカウントダウンを表示するが、自動開始は行わない。`startAt` はLive Runのrun configから渡し、`show.json` は開始時刻を持たない。

### 状態契約

ステージはサーバから`StageState`を受け取り、描画と音声再生だけを行う。状態の例を次に示す。

```jsonc
{
  "phase": "script",
  "segment": { "id": "seg-news-1", "label": "ニュース1" },
  "characters": {
    "left": { "expression": "smile", "speaking": true },
    "right": { "expression": "normal", "speaking": false }
  },
  "caption": { "speaker": "left", "text": "今週のニュースです。" },
  "visual": {
    "kind": "card",
    "cardId": "card-news",
    "stateId": "state-point-1",
    "sequence": 3
  },
  "comment": null,
  "status": "speaking",
  "cutIn": null,
  "playback": {
    "cueId": "cue-news-1-1",
    "attempt": 1,
    "sequence": 1,
    "startedAt": "2026-11-07T12:00:00.000Z",
    "audioUrl": "audio/prepared/cue-news-1-1.wav"
  },
  "clock": { "elapsedMs": 300000, "remainingMs": 1500000 }
}
```

- `phase`は前節のフェーズ。
- `characters`は左右の表情と発話状態。表情IDは`characters.json`のプリセットを参照する。
- `caption`は現在の字幕。`null`なら字幕を消す。
- `visual`は中央スロットに表示する単一のビジュアル。`kind: "card"`は`cardId`・`stateId`、`kind: "material"`は`materialId`・`focus`を持つ。`null`ならカードも素材も表示しない。実効ビジュアルはサーバーがCueとSegmentの既定から解決する。`materialId`と`segment.material`は持たない。
- `visual.sequence`は実効ビジュアルが変わるたびに増える。ステージは直前に適用した値より小さい非nullのsequenceを無視し、遅れて届いた状態で古いカードへ戻らない。同じビジュアルの再送では増えない。
- `comment`はコメントカード。`state`は`reading`または`responding`。
- `status`は`idle`・`thinking`・`speaking`。キャラクターの待機・考え中・発話の表現に使う。
- `playback`は現在の再生試行。programステージだけがこれを使って音声を再生し、`audio_ended`を返す。
- `cutIn`はCutInの再生試行。CutIn中だけ非nullとし、`cutInId`・`segmentId`・`label`・`file`・`durationMs`・`hasAudio`・`attempt`・`sequence`・`startedAt`を持つ。CutIn中は`playback`をnullにし、通常のCue音声と混ぜない。詳細は [../live-media-playout/spec.md](../live-media-playout/spec.md) を正とする。
- `clock`は経過時間と残り時間。コンソールとディレクターが使い、ステージでは任意表示とする。

ステージは次のイベントをサーバへ返す。

- `stage_ready`: フォントと初期画像の読み込み完了。
- `audio_ended`: 現在のキューの音声再生完了。
- `audio_error`: 音声の読み込み・再生失敗。
- `cut_in_ended`: 現在のCutInの映像再生完了。
- `cut_in_error`: CutInの読み込み・再生失敗。
- `card_error`: ネイティブカードの読み込み・描画失敗。`cardId`・`stateId`・`error`を持ち、`sequence`はVisual sequenceとする。
- `stage_heartbeat`: 接続維持と状態同期。

各イベントは`runId`・`sessionId`・`cueId`・`attempt`・`sequence`を持ち、programステージだけが送る。サーバは現在の`cueId`・`attempt`・`sequence`に一致しないオーディオイベントを無視する。CutInのイベントは`cueId: null`と`cutInId`・`segmentId`を持ち、現在のoccurrenceと一致しないイベントを無視する。`card_error`はカード/状態/理由ごとに重複を抑えてRun logとコンソール通知に残し、進行を止めない。previewはイベントを送らない。

サーバはステージの接続時に最新の`StageState`を送る。ステージが再接続した場合は、現在のキューと再生位置を送り、可能ならシークして再開する。CutIn中は`cutIn.startedAt`から位置を求め、尺を過ぎていれば終了を通知する。再開できない場合は現在のキューまたはCutInを先頭から再生し、二重再生を避ける。

### 見た目の再利用

ステージのレイアウトはライブ専用に作るが、見た目の部品はKakeaiから書き出す。

- テーマCSS変数（色、フォント、余白、影、角丸）。
- `skin`背景（neutralまたはhandmade-paper）。
- キャラクターの外観画像、顔レイヤー、表情プリセット、立ち位置の計算。
- 字幕のCSS、折返し、話者名タブ。
- 素材カード（静止PNG/HTML/短い無音MP4）。
- CutInの全画面MP4（埋め込み音声を含められる）。
- 準備済み音声と、生成レス用のTTS声設定。

コンポジションのScene・Cue・タイムライン・プレイヤーはライブの進行に使わない。ステージはライブ専用の小さな状態機械である。

## プレイアウト

プレイアウトは、ライブキューを音声再生に合わせて進める状態機械である。

### 再生の所有者

- サーバは`StageLease`を発行する。`leaseId`・`runId`・`sessionId`・`role`（`program`または`preview`）・`expiresAt`を持つ。
- programステージは1つだけリースを保持する。OBSに出すステージがprogramであり、音声を再生できるのはprogramだけとする。
- コンソールのプレビューは`role: "preview"`で接続し、ミュート・イベント非送信とする。プレビューから`audio_ended`を送らない。
- `StageState.playback`は、`cueId`・`attempt`・`startedAt`・`audioUrl`を持つ。
- CutInは`StageState.cutIn`で指示し、`StageState.playback`とは別に扱う。programだけが埋め込み音声を再生し、previewはミュートする。
- `StageEvent`は、`runId`・`sessionId`・`cueId`・`attempt`・`sequence`・イベント種別を持つ。CutInのイベントは`cutInId`・`segmentId`も持つ。サーバは現在の`cueId`または`cutInId`・`attempt`・`sequence`に一致しないイベントを無視する。
- ウォッチドッグは`attempt`単位で動かす。古い試行のタイムアウトで現在のキューを進めない。
- programステージが切断した場合、リースは`expiresAt`までに失効する。オペレーターはコンソールから明示的にprogramを引き継ぐ。自動で別のステージをprogramに昇格しない。
- 明示的な引き継ぎや失効でロールが変わったとき、サーバは対象ステージへ新しいリースを通知する。ステージは再生を止めずに、音声を出さない状態からprogramの音声再生へ切り替える。
- 再接続したprogramステージには、サーバが現在のキューと再生位置を送る。再開できなければ同じ`attempt`の先頭から再生し、古いイベントは無視する。

### キュー

```jsonc
{
  "id": "cue-news-1-1",
  "source": "prepared",
  "origin": "script",
  "speaker": "left",
  "caption": "今週のニュースです。",
  "speech": "こんしゅうの にゅーすです。",
  "expression": "smile",
  "audio": "audio/prepared/cue-news-1-1.wav",
  "commentId": null,
  "status": "ready"
}
```

- `source`は`prepared`（書き出し済み）、`generated`（コメント応答）、`manual`（人間が入力）、`fallback`（退避）のいずれか。
- `origin`は`script`（ScriptVersion由来）または`live`（ライブ専用）。`script`なら`sourceLineId`を持つ。
- `status`は`draft`・`preparing`・`ready`・`playing`・`done`・`skipped`・`failed`。
- 生成レスは、同じ形で`source: "generated"`、`audio`は実行ディレクトリの生成音声を持つ。
- 準備済みキューは、書き出し時に音声が存在する。生成キューは、TTS完了後に`ready`になる。

### 進行

- サーバはキューを`preparing`→`ready`→`playing`→`done`の順に進める。各再生試行は`attempt`を持ち、再試行のたびに増やす。
- サーバは`playout.minBufferMs`以上の準備済み音声を常に確保する。`maxThinkingMs`を超える無音は許さない。生成レスが間に合わない場合は、準備済みの退避キューまたは次の準備済みキューを流す。
- 次の数キューを先にTTSし、音声をステージにプリロードさせる。再生終了後に生成を始めない。
- programステージは現在のキューの音声を`<audio>`で再生し、`audio_ended`を`attempt`・`sequence`付きで返す。サーバは現在の試行のイベントだけを受けて次へ進む。
- `audio_ended`が来ない場合に備え、サーバは音声の尺＋余裕を持つウォッチドッグを`attempt`単位で動かす。
- 音声の読み込み・再生に失敗した場合は、そのキューの`attempt`を失敗にし、次のキューへ進む。連続失敗時は一時停止してコンソールに通知する。
- キューが空になったら、台本なら次のセグメント、コメントコーナーなら終了処理へ進む。空のまま進めない場合は、退避キューまたは上限付きの「考え中」で待つ。
- CutInは音声Cueのキューに混ぜず、Spineの`cut_in`セグメントとして開始する。`cut_in_ended`またはwatchdogで次のセグメントへ進む。詳細は [../live-media-playout/spec.md](../live-media-playout/spec.md) を正とする。
- 人間の承認待ちは入れない。生成キューは、生成中にコンソールで編集・キャンセルできる。準備完了後、再生開始前のキューは削除・並べ替えできる。再生開始後は停止・訂正だけを行う。

### 停止・安全モード・訂正

- 停止は、現在の音声またはCutInを100〜200msでフェードアウト／停止し、`paused`へ移る。
- 安全モードは、生成レスを停止し、準備済みの安全なキューだけを流す。コメントコーナーは終了する。CutInは再生せず、次の準備済みセグメントへ進む。
- 訂正は、事前に用意した訂正キュー（「今のは言い過ぎでした」「別の話に戻ります」）を再生し、スパインへ戻る。
- ライブ中の完全な取り消しはできない。VODは後で切る。ログに生成・編集・削除を残す。

## 状態遷移

状態は`pre_show`・`opening`・`script`・`comment`・`cut_in`・`closing`・`post_show`・`paused`・`safe_mode`・`error`とする。操作の優先順位は`error > stop > safe_mode > pause > end > closing > comment > cut_in > current`とする。

| 操作・イベント | 現在 | 次 | アクション |
| --- | --- | --- | --- |
| start | `pre_show` | `opening` | ショー時計を開始し、オープニングの準備済みキューを流す。 |
| pause | 再生中 | `paused` | 現在の音声またはCutInをフェードアウト／停止し、状態を保持する。再開は現在の`attempt`の先頭から。 |
| resume | `paused` | 元の状態 | 現在のキューまたはCutInを再開する。生成キューは再開しない。CutInは先頭から。 |
| stop | 任意 | `paused` | 音声またはCutInを200msでフェードアウト／停止し、生成キューをクリアする。準備済みキューは保持する。 |
| safe_mode | 任意 | `safe_mode` | 生成レスを止め、準備済み・退避キューだけを流す。コメントコーナーとCutInを終了する。 |
| end | `opening` / `script` / `comment` / `cut_in` | `closing` | 現在のキューまたはCutInを終える。残り時間が`closingReserveMs`未満ならコメントコーナーを打ち切る。 |
| audio_ended | 再生中 | 次のキュー / セグメント | 現在の`attempt`と`sequence`のイベントだけを受け付ける。 |
| cut_in_ended | `cut_in` | 次のセグメント / `closing` | 現在の`cutInId`・`segmentId`・`attempt`・`sequence`のイベントだけを受け付ける。 |
| cut_in_error / watchdog | `cut_in` | 次のセグメント / `closing` | 警告を記録して進む。配信は停止しない。 |
| skip_cut_in | `cut_in` | 次のセグメント | 現在のCutInを停止して次へ進む。 |
| corner_empty | `comment` | 次のセグメント | コメント0件ならコーナーをスキップする。 |
| pin_overflow | `comment` | `comment` | `maxExtraSlots`まで延長し、それを超えたら次のコーナーへ回す。 |
| lease_lost | 任意 | `paused` / `error` | programのリース失効。コンソールから明示的に引き継ぐ。 |
| error | 任意 | `error` | 復旧できないエラー。コンソールに通知し、自動再開しない。 |

- `closingReserveMs`は、クロージングに入るために残す時間である（例: 120秒）。残り時間がこれを下回ったら、新しいコメントコーナーを始めない。
- `maxExtraSlots`は、人間ピンが枠を超えたときの延長上限である。上限を超えたピンは次のコーナーへ回す。
- `stop`と`pause`の違いは、生成キューを消すか保持するかである。`stop`は番組を止める操作、`pause`は再開前提の操作とする。
- `end`がCutIn開始前に保留されている場合は、そのCutInを飛ばしてクロージングへ進む。CutIn再生中に押した場合は、そのCutInを最後まで再生してからクロージングへ進む。
- `end`はハードストップではない。現在のキューまたはCutInの再生が終わってからクロージングへ移る。時間を厳密に守る必要はない。

## コメントソース

### 境界

コメントソースは、視聴者コメントを供給する境界である。ライブの他の部分は、YouTubeかfixtureかを知らない。

```ts
interface CommentSource {
  start(): void;
  stop(): void;
  onComment(listener: (comment: CommentEvent) => void): void;
  onStatus(listener: (status: CommentSourceStatus) => void): void;
}
```

`CommentEvent`は、ID、投稿者名、本文、投稿時刻、受信時刻、種別（通常・Super Chat・メンバー）を持つ。本文は外部入力として扱い、HTMLとして実行しない。

### YouTube（読み取り専用）

- 認証は**APIキーを第一候補**とし、OAuthをフォールバックにする。公開ライブチャットの読み取りは`youtube.apiKey`で行い、OAuthスコープ`https://www.googleapis.com/auth/youtube.readonly`はOAuthを使う場合だけ使う。理由は [ADR-0129](../adr/0129-youtube-api-key-first-auth.md) を正とする。
- APIキーは公開データの読み取りだけに使い、YouTube Data API v3に制限する。APIキーにも書き込み権限はなく、配信操作・チャット投稿・モデレーションのAPIは追加しない。実YouTubeのコメント処理はローカルLLMのみという制約も変えない。
- APIキーのリクエストが401、403の`authError`/`forbidden`/`insufficientPermissions`/`keyInvalid`、または400の`keyInvalid`/`API_KEY_INVALID`で失敗し、OAuth設定と有効なトークンがある場合、同じリクエストをOAuthで1回だけ再試行する。再試行は1リクエストにつき1回までとする。
- `liveChatDisabled`、`liveChatEnded`、`liveChatNotFound`は認証で解決しない端末エラーとして扱い、OAuthへフォールバックしない。
- `youtube.apiKey`が無い場合は、`clientId`と`clientSecret`によるOAuthのみの設定を許可する。この場合、従来どおり`live auth`でトークンを保存する。
- `liveChatId`は、コンソールに貼られたYouTubeのライブURLまたは動画IDから、`videos.list`の`liveStreamingDetails.activeLiveChatId`を読んで解決する。解決できない場合は手動入力を許す。
- v1の正規経路は`liveChatMessages.list`のポーリングとする。ポーリング間隔はレスポンスの`pollingIntervalMillis`を既定とし、5秒固定にしない。設定でそれより長くできる。
- `streamList`はP0.5でスパイクする。REST/HTTP2で扱えるか、gRPCの正式依存が必要かを確認し、実装が軽く安定する場合だけ将来の改善として採用する。v1の必須依存にはしない。理由は [ADR-0128](../adr/0128-live-comment-polling-primary.md) を正とする。
- ポーリングは`nextPageToken`を扱い、クォータの概算をコンソールに表示する。30分の配信で、選択した間隔が既定クォータに収まるかを確認できるようにする。
- 配信の作成・開始・終了、チャット投稿、削除、ピン留め、モデレーションは行わない。これらは人間がYouTube StudioまたはYouTubeのチャットUIで行う。
- AIの返答は、ステージの音声と字幕として出す。YouTubeチャットには書き込まない。チャットにもテキストを出したい場合は、将来の書き込み対応ADRで追加する。
- OAuthを使う場合、v1の初回はGoogle CloudのOAuthクライアントをTestingのまま使い、`live auth`で再認証できるようにする。Testingのリフレッシュトークンは7日で失効するため、コンソールに有効期限を表示し、`invalid_grant`を検知したら再認証を促す。APIキーのみの場合は`live auth`も7日失効の警告も不要とする。
- 定期配信を続ける場合は、OAuthアプリの公開・検証をP0.5の判断として扱う。P6の手順書だけに残さない。

### fixture（テストモード）

- `fixtures/comments.json`は、`{ atMs, author, text, kind? }`の配列を持つ。`atMs`はソース開始からの相対時刻である。
- fixtureは、開始・停止・速度変更・リセットを持つ。テストモードでは、実時間を待たずにコメントを流せる。
- 空のfixture、途中で止まるfixture、急に増えるfixture、危険なコメントを含むfixtureを用意する。
- テストモードでは、コメントソースだけを差し替える。フィルター、アナリスト、ディレクター、TTS、ステージ、コンソールは本番と同じものを使う。
- 自動テストでは、コメントソース、LLM、TTSをフェイクに差し替える。手動テストでは、fixtureコメント＋実LLM＋実TTSで通す。

### コメントの扱い

- コメントは信頼できない入力である。HTMLとして実行せず、字幕・コメントカードでは必ずエスケープする。
- プロンプトインジェクションを避けるため、ディレクターに生のコメントを直接渡さない。アナリストが構造化した候補だけを渡す。
- 個人情報、URL、スパム、攻撃、長文、連投は、ルールベースの前処理で除外する。
- コメント主の表示名は、必要な場合だけ使う。個人情報や攻撃的な名前は表示しない。

### YouTubeデータの扱い

- 実YouTubeのコメントは、ローカルLLMだけに渡す。コメント本文・安全要約・生成結果を外部サービスへ送らない。fixtureテストだけ、外部LLMを使ってよい。
- 生コメントは既定で実行中のメモリだけに保持し、長期保存しない。ログに残す場合は、実行単位の短い保持期間（例: 24時間）と`live purge`コマンドを用意し、生コメントではなく投稿ID・匿名化した要約・スコアを残す。
- 分析役のスコア・要約・生成結果もYouTube API由来のデータとして扱い、保持期間と削除手段を持つ。
- OAuthを取り消したときは、トークンとコメント関連のキャッシュを削除する。
- ユーザーガイドに、保存するデータ、保持期間、削除方法、外部LLMを使わないことを記載する。

## コメントコーナーと選択

### コーナー

- コメントは、スパイン上の`comment`セグメントでのみ拾う。v1では台本の途中に即時割り込みしない。
- コメントコーナーは、`commentPolicy.maxCommentsPerCorner`（既定4）の枠を持つ。
- コーナーの入りと締めは、準備済みの固定キューにできる。中身だけを生成する。
- コーナー開始時に、人間ピンとAI候補を合わせて枠を埋める。人間ピンがなければAIが全部拾う。
- コメントが0件なら、コーナーをスキップして次のセグメントへ進む。1〜2件なら短く終える。枠を埋めるために無理に拾わない。
- コーナー中に新しいコメントが来たら、残り枠で拾ってよい。コーナー終了後に来たものは次のコーナーへ回す。
- コーナーを飛ばして時間が余ったら、素材集または現在の話題で調整する。時間が押していたら、そのまま次へ進む。

### 人間ピンとAI候補

- 人間ピンは、台本パートの間にコンソールのコメント一覧から刺せる。ピンは次のコメントコーナーで優先される。
- 人間ピンは確定枠であり、AI候補より先に枠を消費する。ピンが枠を超えた場合は、`maxExtraSlots`まで延長し、それを超えたら次のコーナーへ回す。
- 人間は、AIの候補一覧だけでなく、ライブのコメント一覧からどのコメントでもピンできる。
- 人間ピンには、短いメモ（「質問として」「ツッコミとして」「共感して」など）を添えられる。メモはディレクターの生成に渡す。
- AI候補は、アナリストがスコア、関連性、安全性、質問かどうか、理由、切り口を付けて提示する。AIは残り枠をスコア順に埋める。
- AIのピックを飛ばしたいときは、コンソールの「スキップ」で否定できる。ディレクターは次の候補で埋める。
- 人間ピンが古い場合は、コンソールに投稿時刻と現在の話題との距離を表示する。人間はピンを外せる。ホストは「さっきのコメントで」と橋を架ける。
- 安全の下限は人間でも超えられない。個人情報、攻撃、禁止話題は、ピンされても拾わない。それ以外は人間の判断を優先する。
- コーナー中のピンは、現在の回答が終わった次の境界で入れる。音声を途中で切らない。即時割り込みは行わない。

### コメント分析役

アナリストは、ルールベースの前処理を通ったコメントのバッチを読み、次の構造化出力を返す。

```jsonc
{
  "comments": [
    {
      "commentId": "yt-123",
      "score": 0.82,
      "safety": "ok",
      "relevance": "high",
      "isQuestion": true,
      "reason": "今週のニュースに関係する質問",
      "suggestedAngle": "背景を補足してから答える",
      "safeSummary": "今週のニュースについて、背景を聞きたい",
      "safeQuestion": "なぜこの出来事が起きたのか",
      "piiRedacted": true,
      "urlsRemoved": true
    }
  ]
}
```

- `safety`は`ok`・`review`・`block`。`block`は候補にしない。`review`は人間ピンがある場合だけ候補にする。
- `relevance`は`high`・`medium`・`low`。`low`は候補にしない。
- `safeSummary`は、個人情報・URL・命令文を除去した短い要約。`safeQuestion`は質問の意図を短く表したもの。ディレクターにはこの2つだけを渡し、生コメントはコンソールの人間だけが見る。
- アナリストは応答文を書かない。応答文はディレクターが書く。
- アナリストの出力はZodで検証する。不正な出力は1回だけ再試行し、それでも不正ならそのバッチを捨てる。

## ディレクター

ディレクターは、ライブの次に流すキューを決める。v1では、準備済みキューは固定で流し、LLMはコメント応答の生成にだけ使う。

### ループ

1. 現在のセグメント、経過時間、残り時間、素材、コメント候補を読む。
2. セグメントが`script`なら、準備済みキューを順に流す。素材カードの表示を切り替える。
3. セグメントが`comment`なら、人間ピンとAI候補から枠を選ぶ。0件ならスキップする。
4. 選んだコメントについて、LLMで応答キューを生成する。1〜2文、最大文字数、最大キュー数に収める。
5. 生成結果をZodで検証し、安全フィルターにかける。危険・長すぎる・ペルソナ違反なら、1回だけ再生成し、だめならスキップする。
6. TTSで音声を生成し、`ready`になったキューをプレイアウトへ積む。
7. コーナーが終わったら、次のセグメントへ進む。時間が余っていれば素材集、押していればクロージングへ寄せる。

### 生成契約

ディレクターの出力は、自由文ではなく次の構造化JSONに限る。

```jsonc
{
  "cues": [
    {
      "speaker": "left",
      "caption": "その点について補足すると、…",
      "speech": "そのてんについて ほそくすると、…",
      "expression": "smile"
    }
  ],
  "skip": false
}
```

- `speaker`は左右のどちらか、または`none`。
- `caption`は字幕、`speech`はTTS用の読み上げ。名前・専門用語の読みを`speech`に書かせる。
- `expression`は`characters.json`の表情プリセットID。
- `skip`が`true`なら、そのコメントは拾わない。
- ディレクターの出力は、音声と状態を除く部分キューである。サーバがTTS後に`source: "generated"`の`LiveCue`へ完成させる。
- ツール呼び出し、自由なHTML、任意のCSS、外部URLは受け付けない。
- 出力はZodで検証する。不正なら1回だけ再試行し、だめならスキップする。

### 入力

- ペルソナ、禁止話題、最大文字数、最大キュー数。
- 現在のセグメントの話題、直前の数キューの字幕、残り時間。
- 選んだコメントの`safeSummary`・`safeQuestion`・`suggestedAngle`。生コメント本文は渡さない。
- 人間ピンのメモ。
- 現在の素材カードの見出し。

### タイムアウトと失敗

- LLMのタイムアウトは数秒〜十数秒を設定し、間に合わなければそのコメントをスキップしてスパインへ戻る。
- TTSのタイムアウトも設定し、間に合わなければキューを`failed`にして次へ進む。
- 生成に失敗しても、ライブ全体を止めない。準備済みの台本を流し続ける。
- 失敗はコンソールとログに出す。連続失敗時は安全モードを提案する。

### LLMの配置

- 実YouTubeのコメント分析と応答生成は、**ローカルLLMだけ**を使う。OpenAI互換のローカルエンドポイント（例: Ollama、llama.cpp）を想定し、コメント本文・安全要約・生成結果を外部サービスへ送らない。詳細は [ADR-0123](../adr/0123-live-youtube-local-llm-only.md) を正とする。
- fixtureテストでは、外部LLMを使ってよい。fixtureはYouTubeの実データではないため、品質比較やプロンプト調整に使える。ただし、実YouTubeのコメントを外部LLMへ送る経路を作らない。
- LLMの接続設定は、ライブアプリのローカル設定（`llm.mode`・`baseUrl`・`model`・任意のAPIキー）に置く。ライブパッケージには入れない。実YouTubeの実行時は`mode: "local"`を強制する。
- ローカルLLMが停止・タイムアウトした場合は、そのコメント応答をスキップし、準備済みの台本を続ける。ローカルLLMの品質・速度が足りない場合も、台本と人間ピンのコメントコーナーは成立する。
- 将来、実YouTubeで外部LLMを使う場合は、同意・保持期間・削除・匿名化・告知を含む新しいADRで判断する。

## オペレーターコンソール

コンソールは、ライブを監視し、必要なときだけ介入する画面である。OBSには出さない。

### 表示

- 現在のフェーズ、セグメント、経過時間、残り時間。
- 再生中のキュー、話者、字幕、音声状態。
- キューの一覧（準備済み・生成・手動・退避）と状態。
- コメント一覧（投稿者、本文、時刻、鮮度、フィルター状態、AIスコア、理由）。
- コメントコーナーの枠（人間ピン、AI候補、残り枠）。
- 生成中の応答（字幕、読み上げ、表情）と、編集・キャンセル・再生成。
- 再生中のCutIn（名前、尺、経過、`cutInId`、`segmentId`、`attempt`、`sequence`）と、専用の「CutInをスキップ」操作。`ConsoleSnapshot.cutIn` は再生中のCutInだけ非nullとし、再生していなければnullとする。
- ステージのプレビュー（ミュート・イベント非送信のpreviewステージ）。
- エラー、TTS/LLM/YouTubeの接続状態、ログ。
- テストモードのfixture再生・停止・速度・リセット。

### 操作

- 開始（`pre_show`→`opening`）、終了（`closing`→`post_show`）。
- 一時停止、再開。
- programステージの引き継ぎ（明示操作）。
- ピン、ピン解除、スキップ、コメント一時停止。
- CutInのスキップ（`skip_cut_in`）。通常キューの `skip_cue` とは操作対象を混ぜない。
- 現在の音声の停止（フェードアウト）、安全モード、訂正キューの再生。
- 生成中の応答の編集、キャンセル、再生成。準備完了後、再生開始前のキューの削除・並べ替え。再生開始後は停止・訂正だけ。
- 投稿者・話題のブロック。
- ログの表示、実行ディレクトリのオープン。
- キーボードショートカット（ピン、スキップ、停止、一時停止）。

### 原則

- 人間は承認ゲートではない。生成レスは自動で流れ、人間は非常ブレーキと訂正役になる。
- 人間が何もしなくても、準備済みの台本は進む。
- 人間がピンを刺したら、AIは素直に譲る。人間が無言ならAIが進める。
- 危険な状態（連続失敗、ステージ切断、TTS停止）は、目立つ形で通知する。

## 時間管理

- `targetDurationMs`は目安であり、ハードストップではない。30分を超えても、クロージングに入るまでは続けてよい。早く終わってもよい。
- ディレクターは、経過時間、残り時間、セグメントの目標尺を受け取る。
- 残り時間が少ない場合、コメントコーナーを短くするかスキップする。残り時間が`closingReserveMs`を下回ったら、新しいコメントコーナーを始めない。時間が余る場合、素材集または現在の話題で調整する。
- 終了は、クロージングのキューが終わったとき、または人間が「終了」を押したとき。`post_show`へ遷移する。
- セグメントの目標尺を超えても、自動で打ち切らない。次のセグメントの冒頭で調整する。

## 当日の流れ

1. KakeaiでLive Program Versionを確定し、ライブパッケージv2を書き出す。
2. ライブアプリを起動し、パッケージを読み、ステージとコンソールを開く。
3. OBSのブラウザソースにステージURLを設定し、音声経路を確認する。
4. YouTubeで配信を開始する（人間）。タイトル・サムネイル・公開範囲も人間が設定する。
5. コンソールで`pre_show`を表示し、開始を押す。
6. 台本とコメントコーナーを進行する。必要ならピン、スキップ、停止、訂正を行う。
7. クロージングの後、終了を押して`post_show`を表示する。
8. YouTubeの配信を終了する（人間）。ログを確認する。

## テストモード

- Run のコメントソースを `fixture` にし、Run作成時にコピーした `fixtures/comments.json` を流す。fixture を使うかどうかは run config の `source.kind` だけで決まる。
- テストでも、フィルター、アナリスト、ディレクター、TTS、ステージ、コンソールは本番と同じものを使う。モックするのはコメントの供給元だけ。
- テストでは外部LLMを使ってよいが、渡すのはfixtureコメントだけにする。実YouTubeのコメントを外部LLMへ送る経路を作らない。実YouTubeの受け入れテストはローカルLLMで行う。
- 10分版の Live Program と fixture を用意し、開幕→本編→コメント→クロージング→終了画面を短時間で確認する。
- fixtureには、通常、質問、冗談、URL、スパム、個人情報、長文、絵文字、0件、途中停止、急増を含める。
- 自動テストでは、コメントソース、LLM、TTSをフェイクに差し替える。手動テストでは、fixture＋実LLM＋実TTSで通す。
- テストの合格条件は、音声が途切れない、コメント0件でスキップ、人間ピンが優先、開幕・終了画面、コンソール操作、ステージ再接続が動くこと。
- 実際のYouTubeテストは、30分の非公開配信で1回行う。読み取りのみで、配信操作とチャット投稿は人間が行う。

## ログと永続化

- ライブ実行ごとに、`runs/<runId>/`を作る。実行ディレクトリのルートは`KAKEAI_LIVE_DATA_DIR`で差し替えられ、既定はアプリデータディレクトリ配下の`live/`とする。
- 設定（LLM接続、OAuthトークン、ポート、音声経路）は、ライブアプリの設定ファイルまたは環境変数で管理する。
- `run.json`は、ショー、パッケージ、開始・終了時刻、結果を持つ。
- `events.jsonl`は、フェーズ遷移、コメント選択、生成、編集、削除、スキップ、停止、エラーを時系列で記録する。
- `comments.jsonl`は、既定では生コメントを保存せず、投稿ID・匿名化した要約・スコア・フィルター結果だけを記録する。生コメントを保存する場合は、実行単位の短い保持期間と`live purge`コマンドを必須にする。
- `cues.jsonl`は、キューと音声の状態を記録する。
- `generated/`は、生成した音声を記録する。
- `generated-text.jsonl`は、生成した字幕・読み上げを記録する。
- `errors.log`は、復旧できなかったエラーを記録する。
- ログは追記のみとし、編集・削除はイベントとして残す。KakeaiのDBには書き込まない。
- ログは、配信後のレビュー、プロンプト改善、将来のVOD編集に使う。v1では自動でVODを生成しない。

## 失敗時の挙動

| 状況 | 挙動 |
| --- | --- |
| YouTubeの接続断・クォータ・認証エラー | スパインは続行する。コメントコーナーはスキップまたは終了する。コンソールに通知し、バックオフで再接続する。 |
| `streamList`のスパイクが失敗する | `liveChatMessages.list`のポーリングを正規経路として続行する。 |
| TTSエンジン停止・タイムアウト | その生成キューを`failed`にし、次へ進む。準備済みキューは止めない。 |
| LLMのタイムアウト・不正出力 | そのコメントをスキップし、スパインへ戻る。1回だけ再試行する。 |
| ローカルLLMの停止・未設定 | そのコメント応答をスキップし、準備済みの台本を続ける。実YouTubeでは外部LLMへ切り替えない。 |
| 音声の読み込み・再生失敗 | そのキューをスキップし、次へ進む。連続失敗時は一時停止して通知する。 |
| CutInの読み込み・再生失敗、終了イベント未着 | 警告を記録し、次のセグメントへ進む。連続失敗でも一時停止しない。 |
| ステージの切断・リロード | programのリースを失効させ、オペレーターが明示的に引き継ぐ。previewは再読み込みだけで、再生に影響しない。 |
| サーバのクラッシュ | OBSには最後のフレームが残る。人間がアプリを再起動する。自動復帰しない。 |
| ネイティブカード・素材カードの読み込み/描画失敗 | 中央スロットを非表示にし、スパインを続行する。カード/状態/理由ごとに重複を抑えてRun logとコンソールへ警告を残す。 |
| OBS・音声経路の失敗 | 配信全体の問題として人間が対処する。アプリは検知できる範囲で通知する。 |

原則は「台本を止めない」。生成レスやコメント機能の失敗で、準備済みのライブ全体を止めない。

## Kakeai側の書き出し

書き出しはKakeai APIの`live_export` Jobとして行う。入力は `programVersionId`、任意の fixture 配列、`outDir` だけである。Work / Script Version / 外部プロファイルは受け付けない。

```sh
npm run live:export -- \
  --program-version <programVersionId> \
  --out <output-dir> \
  [--fixture <comments.json>]
```

- `--out`は存在しないディレクトリを要求する。既存のパッケージを上書きしない。
- `--no-tts`は用意しない。準備済み音声は書き出し時に生成する。TTSが必要なCueの生成に失敗した場合は、書き出しを失敗させる。
- 書き出しはKakeaiのDBを変更しない。
- Jobの入力は `liveExportProgramJobSnapshotSchema` に固定し、`programId`、`programVersionId`、版番号、文書ハッシュ、解決スナップショット、キャラクター、Face Set、fixture、出力先、Theme、Asset、Voice Profile、フォントを持つ。
- Jobの結果は`liveExportResult`として、パッケージ絶対パス、`packageId`、manifestのSHA-256、ファイル数、準備済みCue数、警告、失敗したCue・Voice Profile・素材を持つ。APIが絶対ローカルパスを返すのはこの結果だけとし、ループバック限定のCLI利用に限る。
- 実行中の`live_export`は協調キャンセルできる。Workerはキュー境界とTTS完了後に状態を確認し、現在の1件が終わってから停止する。
- 出力先は存在しないディレクトリを要求し、書き出し途中の失敗で既存パッケージを上書きしない。一時ディレクトリに書いてからrenameで確定する。

### 解決とコピー

- 版の `resolutionSnapshot` から Theme、キャラクター外観、Face Set、Voice Profile、音声Asset、CutIn、Live Material を解決する。現在のDB行がスナップショットと一致しない場合は書き出しを失敗させる。
- Theme Revisionを解決し、`theme.css`を生成する。Font Faceはローカルフォントのスタックを使い、同じMacで実行する前提とする。
- キャラクターの外観画像、顔レイヤー、表情プリセットを`media/characters/`へコピーする。`characters.json`を生成する。
- Live Material のスナップショットを静止PNGの素材カードとして`materials/`へ出力する。ネイティブカードの画像Assetは`cards/`へコピーする。
- CutInのvideo Assetを収集し、必要ならH.264/AACのMP4へ正規化して`media/assets/`へコピーする。最終MP4をprobeし、尺・寸法・音声有無を`show.cutIns`とmanifestへ記録する。
- 準備済みCueの音声を`audio/prepared/`へ出力する。`audioAssetId`があるCueはそのAssetを必ず使い、利用できなければ失敗する。それ以外はTTSする。参照音声を使うVoice Profileは、参照音声Assetを`media/voice/`へコピーする。
- `show.json`を生成し、Cue、カード、カード画像、素材、CutIn、スピーカー、コメントポリシー、安全設定、プレイアウトを解決する。
- `manifest.json`に、`packageSchemaVersion: 2`、Live Program Version の `source`、`cardSchemaVersion: 1`、全ファイルのSHA-256・byteSize・mediaType・種別・尺・寸法・無音フラグ、フォント診断、エクスポーター版を記録する。
- パッケージ内に絶対パスを残さない。シンボリックリンクを使わない。

### TTSアダプタの共有

生成レス用のTTSは、KakeaiのJob APIを経由せず、TTSアダプタを直接呼ぶ。Jobは永続化と監査に向くが、ライブの即時生成には重い。

- `packages/tts`のアダプタ実装を`apps/api`と`apps/live`の両方から使う。
- アダプタの契約は [../../packages/contracts/src/tts.ts](../../packages/contracts/src/tts.ts) の`TtsAdapter`を正とする。
- `characters.json`に、話者ごとの`adapterId`、`voiceId`、`speedScale`、`settings`、`refAudio`（パッケージ内の相対パス）を保存する。`baseUrl`・APIキーはライブアプリの設定に置く。詳細は [ADR-0127](../adr/0127-live-tts-voice-snapshot-boundary.md) を正とする。
- ライブアプリの設定に`tts.adapters`（`baseUrl`・任意のAPIキー）を持つ。ローカルTTSは、Kakeaiと同じくループバックのみを許可する。
- 参照音声を使うVoice Profileは、書き出し時に参照音声Assetを`media/voice/`へコピーし、manifestにハッシュ・mediaType・尺を記録する。実行時にライブアプリが相対パスを絶対パスへ解決し、`TtsSynthesisRequest.refAudioPath`へ渡す。
- 書き出し時に各Voice Profileで短いテスト合成を行い、失敗したら書き出しを失敗させる。
- 生成音声は`runs/<runId>/generated/`へ書き、配信後に削除できる。

## セキュリティとローカル境界

- ライブアプリは`127.0.0.1`だけで待ち受ける。外部公開しない。
- ステージとコンソールは、HostとOriginの検証を行う。同一originのローカルアクセスだけを受け入れる。
- ライブパッケージは信頼済みのKakeai出力だけを使う。視聴者コメントや外部HTMLを素材カードとして実行しない。
- コメント、投稿者名、生成テキストは、HTMLとして実行せず、必ずエスケープする。
- YouTubeのAPIキーとOAuthリフレッシュトークンは、ライブアプリの設定ディレクトリまたは設定ファイルに置き、利用者だけが読める権限で保存する。APIキー・アクセストークンはログ、コンソールのstatus、エラー本文に出さない。
- APIキーは公開データの読み取りだけに使う。キーを共有したり、リポジトリにコミットしたりしない。OAuthを使う場合は`youtube.readonly`だけを要求する。
- TTSの接続設定（`baseUrl`・APIキー）はライブアプリのローカル設定に置く。ローカルTTSはループバックのみを許可する。
- ログには個人情報を含み得るため、保存先と共有範囲を利用者が管理する。
- 配信の開始・終了、チャット投稿、モデレーションはアプリの権限外とする。

## 受け入れ条件

1. Kakeaiで作成したLive Program Versionから、パッケージv2を書き出せる。Cueは字幕・読み上げ・話者・表情・中央ビジュアルを直接持ち、`lineId`を参照しない。パッケージ内のファイル参照は相対URLで完結し、テーマ、キャラクター、カード、素材カード、CutIn、準備済み音声、参照音声を含む。フォントは同じMacのローカルフォントを使う。
2. `apps/live`を起動し、パッケージを読み、`pre_show`を表示できる。programとpreviewが分かれ、programだけが音声を再生する。オペレーターが開始すると、オープニングの準備済みキューが音声付きで流れる。
3. ステージに左右のキャラクター、字幕、中央の素材カード、セグメントラベルが表示され、音声が途切れない。話者に応じて口パク・表情・待機が切り替わる。
4. コメントコーナーで、人間ピンがAI候補より優先される。人間ピンがなければAIが枠を埋める。コメントが0件ならコーナーをスキップする。
5. 生成レスは自動で流れ、コンソールから生成中の編集・キャンセル、準備完了後・再生開始前の削除・並べ替え、再生中の停止・訂正ができる。承認遅延はない。
6. `pre_show`、`post_show`、`paused`、`error`の画面が動く。
7. テストモードで、10分版のfixtureコメントを使い、音声途切れ、コメント0件スキップ、ピン優先、コンソール操作、ステージ再接続、重複・古い再生イベントの無視を確認できる。
8. 実際のYouTubeライブで、`liveChatMessages.list`のポーリングによりコメントを読み取り、読み取り専用のまま30分の非公開配信を実行できる。配信操作とチャット投稿は人間が行う。実YouTubeのコメント処理はローカルLLMのみを使い、外部LLMへ送らない。`streamList`はスパイクで実用性を確認できた場合だけ追加する。
9. YouTube、TTS、LLM、ステージのいずれかが失敗しても、準備済みの台本は止まらない。失敗はコンソールとログに残る。
10. `npm run typecheck` と `npm test` が通る。ライブの契約、コメントソース、選択ポリシー、プレイアウト、ディレクター出力、パッケージ書き出し、実YouTube経路で外部LLMが呼ばれないことのテストがある。
11. programステージだけが音声を再生し、previewはミュート・イベント非送信である。古い`attempt`や重複した`audio_ended`でキューが二重に進まない。
12. `cut_in`セグメントとCutInを書き出し、ステージで全画面再生できる。programだけが埋め込み音声を再生し、previewはミュートされる。pause後は先頭から再開し、再接続は`startedAt`からシークする。失敗時は警告を残して次のセグメントへ進み、配信を停止しない。

## 非ゴール

- YouTubeの配信作成・開始・終了、タイトル・説明・サムネイル設定。
- YouTubeチャットへの投稿、削除、ピン留め、モデレーション。
- コンポジションのScene・Cue・タイムラインをライブの進行に使うこと。
- HyperFrames Playerをライブのステージの進行に使うこと。
- 素材カードをiframe内のコンポジションタイムラインで動かすこと。
- CutInのBGM、複数動画の連結、トリム・ループ、トランジション、Web編集UI。
- 台本の途中への即時コメント割り込み。
- 人間の承認遅延（放送遅延）を入れること。
- AIだけでの完全自律進行（v1は人間ピンとAI補充の併用を主とする）。
- 実YouTubeのコメントを外部LLMへ送ること（v1はローカルLLMのみ）。
- 複数利用者、クラウド配信、リモートステージ。
- VODの自動編集、配信アーカイブの取り込み。
- 多言語ライブ、縦型ステージ。
- Super Chatの決済・返金・表示の高度な扱い。
- サーバクラッシュからの自動復帰。

## 未決事項

- `streamList`がNode/RESTまたはgRPCから実用的に使えるか。使える場合の追加依存と再接続の契約。v1の正規経路は`list`ポーリングとする。
- LLMのモデル・量子化・必要ハードウェア・P95レイテンシ。実YouTubeはローカルLLMのみとし、fixtureテストでは外部LLMも比較に使う。
- YouTube APIデータの保持期間、削除UI/コマンド、OAuth失効時の消去の詳細。
- ステージの正確なCSS、キャラクターの立ち位置、素材カードのサイズ。
- 素材カードのiframeミニランナーが必要になったときの再生・停止・seekの契約。
- OBSの音声経路（ブラウザソースの音声か、デスクトップ音声か）。
- 公開ライブチャットをAPIキーだけで読めることの実配信での確認。失敗した場合のOAuthフォールバックの運用。OAuthを使う場合のリフレッシュトークンの保存場所、Testingクライアントの7日失効、公開・検証の時期。
- ローカルLLMの実行環境（Ollama等）とモデルの初期候補。
- ライブパッケージ書き出しのUI。v1は`live_export` JobとCLI。
- 素材集（フィラー）の自動選択。v1はスパイン中心。
- VOD用のログ活用。v1は記録だけ。
