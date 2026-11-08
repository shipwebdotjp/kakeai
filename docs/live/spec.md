# ライブ配信仕様（AI進行のYouTubeライブ）

## 目的と境界

この文書は、Kakeaiで制作した台本・キャラクター・素材・テーマ・声を使い、AIキャラクターが進行するYouTubeライブを、ローカルMac上で実行するための仕様を定める。

- ライブの出力は、OBSでキャプチャするブラウザの**ステージ**である。MP4のレンダーではない。
- ライブの正本は、Kakeaiの既存データ（ScriptVersion、Theme、Character、Asset、VoiceProfile）と、ライブ用の**ショープロファイル**である。ライブ実行時は、書き出した**ライブパッケージ**だけを読む。
- 既存のコンポジション（Scene・VisualCue・タイムライン）をライブの進行に使わない。ライブは**状態駆動の別ランタイム**である。理由は [ADR-0120](../adr/0120-live-runtime-separate-from-composition.md) を正とする。
- 準備済みキューは原則としてScriptVersionの`NarrationSegment`から`lineId`で導出し、ライブ専用キュー（開幕・訂正・退避など）だけを別に持つ。理由は [ADR-0124](../adr/0124-live-cues-derived-from-script.md) を正とする。
- 再生はprogramステージ1つがリースを持ち、コンソールのpreviewはミュート・イベント非送信とする。理由は [ADR-0125](../adr/0125-live-program-playback-lease.md) を正とする。
- 素材カードは静止PNG/HTMLまたは短い無音MP4に限定し、コンポジションのタイムラインをライブで再生しない。理由は [ADR-0126](../adr/0126-live-material-cards-static-or-mp4.md) を正とする。
- TTSの接続設定はライブアプリに置き、パッケージは声のスナップショットと参照音声だけを持つ。理由は [ADR-0127](../adr/0127-live-tts-voice-snapshot-boundary.md) を正とする。
- v1のコメント取得は`liveChatMessages.list`のポーリングを正規経路とし、`streamList`はP0.5のスパイク後に判断する。理由は [ADR-0128](../adr/0128-live-comment-polling-primary.md) を正とする。
- YouTube連携は**読み取り専用**とする。配信の開始・終了、タイトル・サムネイル設定、チャット投稿、モデレーションは人間が行う。理由は [ADR-0121](../adr/0121-youtube-read-only-comment-source.md) を正とする。
- ライブのコメントは**コメントコーナー**で拾う。人間が選んだコメント（人間ピン）を優先し、残りをAI候補が埋める。即時割り込みはv1では行わない。理由は [ADR-0122](../adr/0122-live-comment-corner-human-pin.md) を正とする。
- v1の実YouTubeでは、コメントの分析と応答生成に**ローカルLLMだけ**を使う。生コメントも要約も外部LLMへ送らない。fixtureテストでは外部LLMを使ってよい。理由は [ADR-0123](../adr/0123-live-youtube-local-llm-only.md) を正とする。
- 対象はローカルの単一利用者、`ja-JP`、30分を目安とするライブである。クラウド配信、複数ユーザー、配信作成、チャット投稿、VOD編集はv1の対象外とする。

既存の台本契約は [../mvp/content-schema.md](../mvp/content-schema.md)、テーマは [../visual-themes/spec.md](../visual-themes/spec.md) と [../theme-customization/spec.md](../theme-customization/spec.md)、キャラクターと表情は [../face-expression/spec.md](../face-expression/spec.md) と [../standing-states/spec.md](../standing-states/spec.md)、TTSは [../tts/spec.md](../tts/spec.md) と [../multilingual-voice/spec.md](../multilingual-voice/spec.md) を正とする。この文書は、それらをライブ用にどう組み合わせるかを定める。

## 用語

用語の正は [CONTEXT.md](../../CONTEXT.md) とする。本書で頻出する用語は次のとおり。

| 用語 | 意味 |
| --- | --- |
| ライブショー | 1回のライブ配信の単位。ショープロファイル、スパイン、素材、キャラクター、声を持つ。 |
| ライブパッケージ | ライブショーを実行するための不変の書き出し。テーマCSS、キャラクター素材、素材カード、事前音声、ショープロファイルを含む。 |
| ステージ | OBSでキャプチャする1920x1080のブラウザ画面。キャラクター、字幕、素材、コメントカード、フェーズを描画する。 |
| プレイアウト | ライブキューを音声再生に合わせて進める状態機械。タイムラインではない。 |
| ライブキュー | ライブの最小出力単位。話者、字幕、読み上げ、表情、素材、コメント、音声を持つ。 |
| PreparedCue | 書き出し時にScriptVersionまたはライブ専用キューから解決された準備済みキュー。`origin`は`script`または`live`。 |
| programステージ | 再生リースを持ち、音声を再生する唯一のステージ。OBSに出す。 |
| previewステージ | コンソールで状態を確認するための、ミュート・イベント非送信のステージ。 |
| コメントコーナー | 視聴者コメントをまとめて拾う、スパイン上の区間。常時コメントを拾うモードはv1では使わない。 |
| スパイン | ライブの予定されたセグメント順。コンポジションのタイムラインではない。 |
| 素材集 | 時間が余ったときや調整に使う追加の話題・ネタ・退避素材。v1では必須ではない。 |
| 人間ピン | オペレーターが次のコメントコーナーで拾うと明示したコメント。AI候補より優先される。 |
| AI候補 | コメント分析役が提示する候補。人間ピンの残り枠を埋める。 |
| ショープロファイル | ライブ固有の構成、コメントポリシー、安全設定、ステージ、目標尺を持つ設定。ScriptVersionではない。 |
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

### 実装構成（v1）

- `apps/live` はNode + TypeScriptのローカルサーバー。HTTPはExpress、WebSocketは`ws`を使う。パッケージ配信、実行ディレクトリの管理を持つ。
- ステージとコンソールはViteでビルドした静的ページとして配信する。ステージはフレームワーク非依存の軽量ページ、コンソールはReact + Viteとする。
- コメント取得、分析、ディレクター、プレイアウト、ログはサーバー側で動かす。ステージは状態描画と音声再生、コンソールは操作と表示を担当する。
- LLMの接続設定はライブアプリのローカル設定に置く。実YouTubeは`mode: "local"`を強制し、fixtureテストだけ外部LLMを許可する。
- 起動は `npm run live -- --package <dir> [--test] [--port <port>] [--config <file>]` を想定する。ライブの実行にKakeaiの起動は不要とする。

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
    material-news-2.mp4
    material-news-3.html
  media/
    characters/
      left-base.png
      left-eye-normal.png
      left-mouth-speaking.png
    materials/
      news-1.png
    voice/
      ref-a.wav
  audio/
    prepared/
      cue-opening-1.wav
      cue-news-1-1.wav
  fixtures/
    comments.json
```

- `manifest.json` は、パッケージのスキーマ版、書き出し元のWork・LanguageEdition・ScriptVersion・Theme Revision、作成日時を持つ。
- `show.json` は、ショープロファイルとスパイン、素材、キュー、コメントポリシー、安全設定を持つ。
- `theme.css` は、解決済みのテーマCSS変数とフォントスタックを持つ。テーマの色・書体・余白・影・角丸を、ステージと素材カードで共有する。
- `characters.json` は、左右のキャラクターの外観画像、顔レイヤー、表情プリセット、立ち位置、声の設定を持つ。
- `materials/*.png` / `*.html` / `*.mp4` は、素材カードの静止画・静的HTML・短い無音動画である。Kakeaiの単一Sceneから書き出す。
- `media/` は、キャラクター画像、顔レイヤー、素材カードの画像・動画、TTSの参照音声を持つ。`show.json` と素材カードからは相対URLで参照する。
- `media/voice/` は、参照音声を使うTTSの音声ファイルを持つ。パッケージには接続設定を入れず、参照音声だけを固定する。
- `audio/prepared/` は、準備済みキューの音声を持つ。既存のAudio Takeがあればそれを使い、なければ書き出し時にTTSで生成する。
- `fixtures/comments.json` は、テストモード用のコメント列を持つ。任意。

パッケージは書き出し後に変更しない。ライブ実行中の生成音声、ログ、編集履歴は、パッケージとは別の**実行ディレクトリ**へ書く。

### manifest.json

`manifest.json`は、パッケージの完全性と再現性を検証するための情報を持つ。

```jsonc
{
  "packageSchemaVersion": 1,
  "exporterVersion": "0.1.0",
  "packageId": "livepkg-...",
  "createdAt": "2026-11-07T12:00:00.000Z",
  "source": {
    "workId": "...",
    "languageEditionId": "...",
    "scriptVersionId": "...",
    "theme": { "id": "...", "version": 3 }
  },
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
    }
  ],
  "fonts": [
    { "role": "caption", "family": "...", "found": true, "fallback": "sans-serif" }
  ],
  "voices": [
    {
      "characterId": "char-left",
      "adapterId": "voicevox",
      "voiceId": "...",
      "refAudio": "media/voice/ref-a.wav",
      "refAudioSha256": "..."
    }
  ]
}
```

- `files`は、`manifest.json`を除くパッケージ内の全ファイルのSHA-256・byteSize・mediaType・種別・尺・寸法・無音フラグを持つ。`manifest.json`自身は自己ハッシュできないため含めない。Loaderは`manifest.json`以外の全ファイルが`files`と一致し、`files`にないファイルが`manifest.json`以外にないことを検証する。
- `fonts`は、テーマのフォント役割ごとの解決可否とfallbackを持つ。不足は既定で警告とし、`required`のフォントだけ停止扱いにできる。
- `voices`は、参照音声を使うVoice Profileの参照音声パスとハッシュを持つ。接続設定は含めない。
- ライブアプリは起動時に、ファイルの欠落・ハッシュ不一致・未対応mediaType・カードの音声混入・フォント不足を検証する。ファイル欠落・ハッシュ不一致・未対応mediaType・カードの音声混入は停止、フォント不足は警告を既定とする。
- 音声はWAVまたはMP3を許可する。既存Audio Takeは、再生可能なRenditionをコピーするか、書き出し時に正規化する。

### 書き出し

書き出しはKakeai APIの`live_export` Jobとして行う。コマンド、Job、解決とコピーの詳細は[Kakeai側の書き出し](#kakeai側の書き出し)を参照する。

### 素材カード

素材カードは、ライブの中央スロットに表示する視覚素材である。v1では、Kakeaiの単一Sceneから**静止PNG/HTMLまたは短い無音MP4**を書き出し、ステージの中央に`img`・`video`・スクリプトなしのsandbox iframeで表示する。コンポジションのGSAPタイムラインやHyperFrames Playerはライブで動かさない。理由は [ADR-0126](../adr/0126-live-material-cards-static-or-mp4.md) を正とする。

- 素材カードは1920x1080で作り、中央スロットに縮小する。文字やカードの見た目はKakeaiのプレビューと一致する。
- セグメントは既定素材を持ち、`scriptCues[].materialId`でCue単位に上書きできる。未指定はSegment既定、`null`は非表示、文字列はその素材を表示する。詳細は [../live-cue-materials/spec.md](../live-cue-materials/spec.md) を正とする。
- 静止カードはPNGまたは静的なHTMLとする。短い動きが必要なカードだけ、3〜5秒の無音MP4にする。
- 静的HTMLは、スクリプトを実行しないsandbox iframeで表示する。GSAPタイムラインやプレイヤーは動かさない。
- カードは音声を持たない。音声はプレイアウトのキューが担当する。manifestの`hasAudio: false`で検証する。
- カードのAsset URLは、HTML文字列の置換ではなく、書き出し時のAsset Resolverでパッケージ相対URLとして生成する。
- カードのHTML/MP4は、Kakeaiが生成した信頼済みのものだけを使う。視聴者コメントや外部HTMLをカードとして実行しない。
- iframe内のGSAPランナーやフルPlayerはv1では使わない。静的HTMLはスクリプトなしのsandbox iframeで表示する。必要になった時点で別の契約を追加する。

## ショープロファイル

ショープロファイルは、ライブの構成とポリシーを定めるJSONである。v1では手書き、エージェント、または`--auto-profile`の自動生成で作り、将来UIを追加する。契約は `packages/contracts` のライブ用スキーマを正とする。

書き出し前の**LiveShowProfile**は、台本の行を`lineId`で参照し、ライブ専用のキューだけを明示する。書き出し後の**LivePackageShow**（`show.json`）は、ScriptVersionから解決した`PreparedCue`を持つ。通常の準備済みキューを`caption`/`speech`で二重に書かない。理由は [ADR-0124](../adr/0124-live-cues-derived-from-script.md) を正とする。

### 入力 LiveShowProfile

```jsonc
{
  "schemaVersion": 1,
  "show": {
    "title": "今週のニュース",
    "locale": "ja-JP",
    "targetDurationMs": 1800000,
    "stageTemplate": "news-desk",
    "theme": "theme.css",
    "characters": { "left": "char-left", "right": "char-right" },
    "startAt": null
  },
  "commentSource": { "kind": "youtube" },
  "segments": [
    {
      "id": "seg-opening",
      "kind": "opening",
      "label": "オープニング",
      "targetDurationMs": 120000,
      "cues": ["cue-opening-1"]
    },
    {
      "id": "seg-news-1",
      "kind": "script",
      "label": "ニュース1",
      "targetDurationMs": 480000,
      "material": "material-news-1",
      "cues": ["cue-news-1-1", "cue-news-1-2"]
    },
    {
      "id": "seg-comments-1",
      "kind": "comment",
      "label": "コメント",
      "targetDurationMs": 300000,
      "commentPolicy": { "maxCommentsPerCorner": 4, "maxHumanPinsPerCorner": 4 }
    },
    {
      "id": "seg-closing",
      "kind": "closing",
      "label": "クロージング",
      "targetDurationMs": 120000,
      "cues": ["cue-closing-1"]
    }
  ],
  "scriptCues": [
    {
      "id": "cue-news-1-1",
      "lineId": "line-news-1-1",
      "expressionId": "smile",
      "materialId": "material-news-1"
    }
  ],
  "liveCues": [
    {
      "id": "cue-opening-1",
      "speaker": "left",
      "caption": "今週も始まりました。",
      "speech": "こんしゅうも はじまりました。",
      "expression": "smile"
    }
  ],
  "materials": [
    {
      "id": "material-news-1",
      "sceneId": "scene-news-1",
      "focus": true
    }
  ],
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
    "blockedTopics": ["政治", "宗教", "医療", "法律", "金融"],
    "persona": "親しみやすいニュース解説キャラクター。断定しすぎず、不明なことは保留する。",
    "maxResponseChars": 180,
    "maxResponseCues": 2,
    "fallbackCueId": "cue-fallback-1"
  },
  "playout": {
    "minBufferMs": 10000,
    "maxThinkingMs": 2000,
    "closingReserveMs": 120000,
    "noApprovalDelay": true
  },
  "test": {
    "fixture": "fixtures/comments.json"
  }
}
```

例では`scriptCues`・`liveCues`・`materials`を一部省略している。実際は`segments`が参照するIDをすべて含む。

- `targetDurationMs` は目安であり、厳密な終了時刻ではない。超過・不足を許容する。
- `commentSource.kind` は `youtube` または `fixture`。通常は`youtube`とし、テストモードでは`fixture`に切り替えて`test.fixture`を読む。
- `segments` はスパインである。`opening`、`script`、`comment`、`closing`の順に並べる。
- `script` セグメントは、`scriptCues`または`liveCues`のIDと、任意の素材カードを持つ。セグメントの素材は、Cueが明示しない場合の既定素材である。
- `comment` セグメントは、コメントコーナーである。`commentPolicy`で枠数を上書きできる。
- `scriptCues` は、`lineId`で`NarrationSegment`を参照する。`caption`・`speech`・`speaker`・`audio`は書き出し時に解決する。`expressionId`は任意の上書きとする。`materialId`は任意で、未指定ならセグメント既定を継承し、`null`なら中央素材を隠し、文字列ならそのCueだけ指定の素材を表示する。詳細は [../live-cue-materials/spec.md](../live-cue-materials/spec.md) を正とする。
- 1つのCueは1回の再生occurrenceとし、同じCue IDを複数のSegmentから参照しない。同じSegment内でのCue IDの重複も拒否する。
- `liveCues` は、オープニング・訂正・退避・臨時の一言など、ScriptVersionに存在しないキューのみ。`caption`・`speech`・`speaker`・`expression`・任意の`audio`を持つ。
- `materials` は、`sceneId`でKakeaiのSceneを参照する。書き出し後に`png`/`html`/`mp4`のカードへ解決される。
- `commentPolicy.maxCommentsPerCorner` は、1回のコメントコーナーで拾う最大件数である。`maxHumanPinsPerCorner`は人間ピンの上限、`maxExtraSlots`はピンが枠を超えたときの延長上限である。
- `commentPolicy.mode` はv1では`corner`だけを実装する。`continuous`と`hybrid`は将来の拡張とする。
- `commentPolicy.allowImmediateInterrupt` はv1では常に`false`とする。台本の途中でコメントを割り込ませない。
- `safety.blockedTopics` は、コメント選別と生成レスの両方で使う。`persona`はディレクターのプロンプトに渡す。`fallbackCueId`は、停止・安全モード・障害時の退避キューである。
- `playout.minBufferMs` は、常時確保する準備済み音声の長さ（ミリ秒）である。`maxThinkingMs`は、無音の「考え中」を許す上限である。`closingReserveMs`は、クロージングに入るために残す時間である。`noApprovalDelay`は、人間の承認待ちを入れないことを表し、v1では常に`true`とする。
- `test.fixture` は、テストモードで使うコメント列である。本番では無視する。

### Show Profile の自動生成

最初の1本を手書きせずに始めるため、APIとCLIはWorkとScriptVersionからShow Profileの下書きを生成できる。

- API: `POST /api/v1/live-profiles/auto` は`workId`・`scriptVersionId`・任意の`title`・`includeCommentCorners`を受け取り、`LiveShowProfile`・表示用summary・warningsを返す。Jobは作成しない。
- CLI: `npm run live:export`の`--auto-profile`がこのAPIを呼び、`--save-profile`で下書きを保存してから書き出す。`--dry-run`はJobを作らず、summary表示（`--save-profile`指定時は保存）だけを行う。
- `intro` Sceneは`opening`、`point` Sceneは`script`、`outro` Sceneは`closing`にする。セリフのない`insert`または`point` Sceneは素材候補にする。
- `scriptCues`は各Sceneの行から作る。話者・キャラクター・声プロファイルがない行、字幕または読み上げが空の行は除外し、warningに残す。
- 左右のキャラクターは、台本で最初に話すキャラクターから2人までを使う。3人以上はwarningを返す。
- opening / closingに行がなければ、placeholderの`liveCue`を作る。
- 素材候補は素材カードの制約を満たすものだけを使い、直前の`script`セグメントに紐づける。満たさないSceneは除外してwarningに残す。
- コメントコーナーは各`script`の後に置き、最後の`script`だけは省く。`script`が1つだけなら1つ置く。`includeCommentCorners: false`で無効にできる。
- 生成する`commentSource`は`youtube`、`safety`・`playout`・`commentPolicy`は既定値とする。`show.title`はWorkタイトル、`--title`で上書きできる。
- 生成結果は通常の`LiveShowProfile`であり、保存後に手で編集できる。APIはScriptVersionのVisual Cueを自動変換しない。

### 出力 LivePackageShow

書き出し後の`show.json`は、次の`PreparedCue`を持つ。

```jsonc
{
  "cues": [
    {
      "id": "cue-news-1-1",
      "origin": "script",
      "sourceLineId": "line-news-1-1",
      "materialId": "material-news-1",
      "speaker": "left",
      "caption": "今週のニュースです。",
      "speech": "こんしゅうの にゅーすです。",
      "expression": "smile",
      "audio": "audio/prepared/cue-news-1-1.wav",
      "durationMs": 4200
    }
  ],
  "materials": [
    {
      "id": "material-news-1",
      "kind": "image",
      "file": "materials/material-news-1.png",
      "hasAudio": false,
      "focus": true
    }
  ]
}
```

- `origin`は`script`または`live`。`script`の`PreparedCue`は`sourceLineId`を必須とする。
- `materialId`は入力の生値を保持する。未指定・`null`・文字列の意味は入力と同じで、実効素材は実行時にSegment既定と合わせて解決する。
- `caption`・`speech`・`speaker`・`audio`・`durationMs`は、`scriptCues`なら`NarrationSegment`とVoice Profileから解決し、`liveCues`なら入力値とTTSから解決する。
- `materials`は、`kind`（`image`/`video`/`html`）、`file`、`hasAudio`を持つ。カードは無音でなければならない。
- 出力`show.json`はライブアプリが読む。入力`LiveShowProfile`は書き出し時だけ使う。

### スパインと素材集

v1の主線はスパイン（`segments`）である。素材集（追加の話題・ネタ・退避素材）は、時間が余ったときのフィラーとして使えるようにするが、v1では必須ではない。スパインが尽きたらクロージングへ進む。素材集の自動選択はロードマップで扱う。

## ステージ

### レイアウト

ステージは1920x1080の固定キャンバスを、OBSのブラウザソースに合わせて拡大縮小する。レスポンシブに再配置しない。

```text
┌──────────────────────────────────────────────┐
│ セグメントラベル                             │
│                                              │
│ [左キャラ]   ┌──────────────────┐   [右キャラ] │
│              │   中央の素材カード  │              │
│              │  (素材カードHTML)   │              │
│              └──────────────────┘              │
│  ┌─ コメント ──────────────┐                  │
│  │ 投稿者 / コメント / 回答中 │                  │
│  └─────────────────────────┘                  │
│  字幕帯（話者名 + 字幕）                      │
└──────────────────────────────────────────────┘
```

- 左・右のキャラクターは、`characters.json`の外観画像と顔レイヤーで描画する。話している側は口パクと軽いバウンド、聞いている側は待機・瞬き・表情を持つ。
- 中央の素材カードは、静止PNGを`img`、短い無音MP4を`video`、静的HTMLをスクリプトなしのsandbox iframeで表示し、1920x1080のカードをスロットに縮小する。動画はミュート・ループとする。素材がないセグメントでは非表示にする。
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
| `closing` | クロージングの準備済みキュー。 |
| `post_show` | 「本日の配信は終了しました」、お礼、次回予告。 |
| `paused` | 一時停止。音声をフェードアウトし、状態を保持する。 |
| `safe_mode` | 生成レスを止め、準備済みの安全なキューだけを流す。 |
| `error` | 復旧できないエラーの表示。オペレーターに通知する。 |

`pre_show`と`post_show`は別ページにしない。同じステージの状態として扱い、OBSのソースを切り替えない。開始と終了はオペレーターが押す。`startAt`がある場合はカウントダウンを表示するが、自動開始はv1では行わない。

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
  "material": { "id": "material-news-1", "focus": true },
  "comment": null,
  "status": "speaking",
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
- `material`は中央に表示する素材カード。現在のCueの`materialId`が未指定ならSegment既定、`null`なら非表示、文字列ならその素材を表示する。
- `comment`はコメントカード。`state`は`reading`または`responding`。
- `status`は`idle`・`thinking`・`speaking`。キャラクターの待機・考え中・発話の表現に使う。
- `playback`は現在の再生試行。programステージだけがこれを使って音声を再生し、`audio_ended`を返す。
- `clock`は経過時間と残り時間。コンソールとディレクターが使い、ステージでは任意表示とする。

ステージは次のイベントをサーバへ返す。

- `stage_ready`: フォントと初期画像の読み込み完了。
- `audio_ended`: 現在のキューの音声再生完了。
- `audio_error`: 音声の読み込み・再生失敗。
- `stage_heartbeat`: 接続維持と状態同期。

各イベントは`runId`・`sessionId`・`cueId`・`attempt`・`sequence`を持ち、programステージだけが送る。サーバは現在の`cueId`・`attempt`・`sequence`に一致しないイベントを無視する。previewはイベントを送らない。

サーバはステージの接続時に最新の`StageState`を送る。ステージが再接続した場合は、現在のキューと再生位置を送り、可能ならシークして再開する。再開できない場合は現在のキューを先頭から再生し、二重再生を避ける。

### 見た目の再利用

ステージのレイアウトはライブ専用に作るが、見た目の部品はKakeaiから書き出す。

- テーマCSS変数（色、フォント、余白、影、角丸）。
- `skin`背景（neutralまたはhandmade-paper）。
- キャラクターの外観画像、顔レイヤー、表情プリセット、立ち位置の計算。
- 字幕のCSS、折返し、話者名タブ。
- 素材カード（静止PNG/HTML/短い無音MP4）。
- 準備済み音声と、生成レス用のTTS声設定。

コンポジションのScene・Cue・タイムライン・プレイヤーはライブの進行に使わない。ステージはライブ専用の小さな状態機械である。

## プレイアウト

プレイアウトは、ライブキューを音声再生に合わせて進める状態機械である。

### 再生の所有者

- サーバは`StageLease`を発行する。`leaseId`・`runId`・`sessionId`・`role`（`program`または`preview`）・`expiresAt`を持つ。
- programステージは1つだけリースを保持する。OBSに出すステージがprogramであり、音声を再生できるのはprogramだけとする。
- コンソールのプレビューは`role: "preview"`で接続し、ミュート・イベント非送信とする。プレビューから`audio_ended`を送らない。
- `StageState.playback`は、`cueId`・`attempt`・`startedAt`・`audioUrl`を持つ。
- `StageEvent`は、`runId`・`sessionId`・`cueId`・`attempt`・`sequence`・イベント種別を持つ。サーバは現在の`cueId`・`attempt`・`sequence`に一致しないイベントを無視する。
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
- 人間の承認待ちは入れない。生成キューは、生成中にコンソールで編集・キャンセルできる。準備完了後、再生開始前のキューは削除・並べ替えできる。再生開始後は停止・訂正だけを行う。

### 停止・安全モード・訂正

- 停止は、現在の音声を100〜200msでフェードアウトし、`paused`へ移る。
- 安全モードは、生成レスを停止し、準備済みの安全なキューだけを流す。コメントコーナーは終了する。
- 訂正は、事前に用意した訂正キュー（「今のは言い過ぎでした」「別の話に戻ります」）を再生し、スパインへ戻る。
- ライブ中の完全な取り消しはできない。VODは後で切る。ログに生成・編集・削除を残す。

## 状態遷移

状態は`pre_show`・`opening`・`script`・`comment`・`closing`・`post_show`・`paused`・`safe_mode`・`error`とする。操作の優先順位は`error > stop > safe_mode > pause > end > closing > comment > current`とする。

| 操作・イベント | 現在 | 次 | アクション |
| --- | --- | --- | --- |
| start | `pre_show` | `opening` | ショー時計を開始し、オープニングの準備済みキューを流す。 |
| pause | 再生中 | `paused` | 現在の音声をフェードアウトし、状態を保持する。再開は現在の`attempt`の先頭から。 |
| resume | `paused` | 元の状態 | 現在のキューを再開する。生成キューは再開しない。 |
| stop | 任意 | `paused` | 音声を200msでフェードアウトし、生成キューをクリアする。準備済みキューは保持する。 |
| safe_mode | 任意 | `safe_mode` | 生成レスを止め、準備済み・退避キューだけを流す。コメントコーナーを終了する。 |
| end | `opening` / `script` / `comment` | `closing` | 現在のキューを終える。残り時間が`closingReserveMs`未満ならコメントコーナーを打ち切る。 |
| audio_ended | 再生中 | 次のキュー / セグメント | 現在の`attempt`と`sequence`のイベントだけを受け付ける。 |
| corner_empty | `comment` | 次のセグメント | コメント0件ならコーナーをスキップする。 |
| pin_overflow | `comment` | `comment` | `maxExtraSlots`まで延長し、それを超えたら次のコーナーへ回す。 |
| lease_lost | 任意 | `paused` / `error` | programのリース失効。コンソールから明示的に引き継ぐ。 |
| error | 任意 | `error` | 復旧できないエラー。コンソールに通知し、自動再開しない。 |

- `closingReserveMs`は、クロージングに入るために残す時間である（例: 120秒）。残り時間がこれを下回ったら、新しいコメントコーナーを始めない。
- `maxExtraSlots`は、人間ピンが枠を超えたときの延長上限である。上限を超えたピンは次のコーナーへ回す。
- `stop`と`pause`の違いは、生成キューを消すか保持するかである。`stop`は番組を止める操作、`pause`は再開前提の操作とする。
- `end`はハードストップではない。現在のキューの再生が終わってからクロージングへ移る。時間を厳密に守る必要はない。

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
- コーナー中のピンは、現在の回答が終わった次の境界で入れる。音声を途中で切らない。即時割り込みはv1では行わない。

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
- ステージのプレビュー（ミュート・イベント非送信のpreviewステージ）。
- エラー、TTS/LLM/YouTubeの接続状態、ログ。
- テストモードのfixture再生・停止・速度・リセット。

### 操作

- 開始（`pre_show`→`opening`）、終了（`closing`→`post_show`）。
- 一時停止、再開。
- programステージの引き継ぎ（明示操作）。
- ピン、ピン解除、スキップ、コメント一時停止。
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

1. Kakeaiでライブパッケージを書き出す。
2. ライブアプリを起動し、パッケージを読み、ステージとコンソールを開く。
3. OBSのブラウザソースにステージURLを設定し、音声経路を確認する。
4. YouTubeで配信を開始する（人間）。タイトル・サムネイル・公開範囲も人間が設定する。
5. コンソールで`pre_show`を表示し、開始を押す。
6. 台本とコメントコーナーを進行する。必要ならピン、スキップ、停止、訂正を行う。
7. クロージングの後、終了を押して`post_show`を表示する。
8. YouTubeの配信を終了する（人間）。ログを確認する。

## テストモード

- `commentSource`を`fixture`に切り替え、`fixtures/comments.json`を流す。起動時の`--test`はショープロファイルの`commentSource`を`fixture`に上書きし、`test.fixture`を読む。
- テストでも、フィルター、アナリスト、ディレクター、TTS、ステージ、コンソールは本番と同じものを使う。モックするのはコメントの供給元だけ。
- テストでは外部LLMを使ってよいが、渡すのはfixtureコメントだけにする。実YouTubeのコメントを外部LLMへ送る経路を作らない。実YouTubeの受け入れテストはローカルLLMで行う。
- 10分版のショープロファイルを用意し、開幕→本編→コメント→クロージング→終了画面を短時間で確認する。
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
| `streamList`のスパイクが失敗する | v1は`liveChatMessages.list`のポーリングを正規経路として続行する。 |
| TTSエンジン停止・タイムアウト | その生成キューを`failed`にし、次へ進む。準備済みキューは止めない。 |
| LLMのタイムアウト・不正出力 | そのコメントをスキップし、スパインへ戻る。1回だけ再試行する。 |
| ローカルLLMの停止・未設定 | そのコメント応答をスキップし、準備済みの台本を続ける。実YouTubeでは外部LLMへ切り替えない。 |
| 音声の読み込み・再生失敗 | そのキューをスキップし、次へ進む。連続失敗時は一時停止して通知する。 |
| ステージの切断・リロード | programのリースを失効させ、オペレーターが明示的に引き継ぐ。previewは再読み込みだけで、再生に影響しない。 |
| サーバのクラッシュ | OBSには最後のフレームが残る。人間がアプリを再起動する。v1では自動復帰しない。 |
| 素材カードの読み込み失敗 | 中央を非表示にし、スパインを続行する。コンソール通知は行わない。 |
| OBS・音声経路の失敗 | 配信全体の問題として人間が対処する。アプリは検知できる範囲で通知する。 |

原則は「台本を止めない」。生成レスやコメント機能の失敗で、準備済みのライブ全体を止めない。

## Kakeai側の書き出し

### P1で確定した入出力

P1の実装で、次の契約を確定した。P1の詳細な作業順は [p1-plan.md](./p1-plan.md) を参照する。

- Show ProfileはCLIが読み、JSON本文として`POST /api/v1/live-exports`へ送る。APIはサーバ上のプロファイルパスを読まない。`test.fixture`はプロファイルファイルからの相対パスとしてCLIが解決し、fixture配列として送る。
- `LiveShowProfile.show`に任意の`speakerSides`（`speakerId` → `left`/`right`）を追加する。未指定なら`speaker.characterId`と`show.characters`で解決する。v1は左右1話者ずつとする。
- `liveCues[].audio`は入力では`audioAssetId`（KakeaiのAudio Asset）とし、出力の`PreparedCue.audio`はパッケージ相対パスにする。
- `materials[]`に`format`（`png`/`html`/`mp4`、既定`png`）と`durationMs`（既定4000、MP4は3000〜5000）を追加する。
- `PreparedCue`に`durationMs`を追加する。音声尺を書き出し時に確定し、P3の先読み・ウォッチドッグ・再接続に使う。
- `manifest.json`の`files`は`manifest.json`自身を含めない。
- `live_export` Jobの結果は`liveExportResult`として、パッケージ絶対パス、`packageId`、manifestのSHA-256、ファイル数、準備済みキュー数、警告、失敗したキュー・Voice Profile・素材を持つ。APIが絶対ローカルパスを返すのはこの結果だけとし、ループバック限定のCLI利用に限る。
- 実行中の`live_export`は協調キャンセルできる。Workerはキュー境界とTTS完了後に状態を確認し、現在の1件が終わってから停止する。
- v1のOpenAI互換TTSは、`settings.refAudioAssetId`ではなく解決済みの`refAudioPath`の有無で参照音声モードを判定する。ライブパッケージの`characters.json`は内部Asset IDを含めず、`refAudio`の相対パスを持つ。

### コマンド

v1はKakeai APIの`live_export` Jobとして書き出す。`npm run live:export` はAPIを叩き、Jobの完了を待つ。書き出し時だけKakeaiの起動が必要で、ライブ実行時は不要とする。APIとUIは将来拡張する。

```sh
npm run live:export -- \
  --work <workId> \
  --script-version <scriptVersionId> \
  --profile <show-profile.json> \
  --out <output-dir>
```

- `--out`は存在しないディレクトリを要求する。既存のパッケージを上書きしない。
- `--no-tts`は用意しない。準備済み音声は書き出し時に生成する。TTSが必要なキューの生成に失敗した場合は、書き出しを失敗させる。
- 書き出しはKakeaiのDBを変更しない。

### 書き出しJob

- `POST /api/v1/live-exports` は`live_export` Jobを作成し、`jobId`を返す。CLIは`GET /api/v1/jobs/:jobId`をポーリングする。
- Jobの入力は、`workId`・`scriptVersionId`・Show Profileのパスまたは内容・出力先ディレクトリである。Jobのスナップショットに入力と出力先を固定する。
- Jobの結果は、パッケージの絶対パス、manifestの検証結果、失敗したキューまたはVoice Profileを返す。
- 書き出しは、Kakeaiの既存サービス（Prisma・Asset・Theme・TTS・コンパイラ）を使う。CLIにDBリーダーやTTS実装を増やさない。
- 書き出し時だけKakeaiの起動が必要である。ライブ実行時はKakeai不要とする。
- 出力先は存在しないディレクトリを要求し、書き出し途中の失敗で既存パッケージを上書きしない。一時ディレクトリに書いてからrenameで確定する。
- `live_export` Jobの追加に伴い、KakeaiのJob種別とAPI契約を更新する。

### 解決とコピー

- `ScriptVersion`の`contentJson`を読み、Show Profileの`sceneId`・`characterId`・`appearanceId`・`voiceProfileId`を検証する。
- Theme Revisionを解決し、`theme.css`を生成する。Font Faceはローカルフォントのスタックを使い、同じMacで実行する前提とする。
- キャラクターの外観画像、顔レイヤー、表情プリセットを`media/characters/`へコピーする。`characters.json`を生成する。
- 素材カードを単一Sceneから静止PNG、静的HTML、または短い無音MP4として書き出し、`materials/`へ出力する。参照Assetを`media/materials/`へコピーし、Asset Resolverで相対URLを生成する。
- 準備済みキューの音声を`audio/prepared/`へ出力する。既存のAudio Takeを優先し、なければTTSする。参照音声を使うVoice Profileは、参照音声Assetを`media/voice/`へコピーする。
- `show.json`を生成し、キュー、素材、キャラクター、コメントポリシー、安全設定、テストfixtureを解決する。
- `manifest.json`に、全ファイルのSHA-256・byteSize・mediaType・種別・尺・寸法・無音フラグ、フォント診断、エクスポーター版を記録する。
- パッケージ内に絶対パスを残さない。シンボリックリンクを使わない。

### TTSアダプタの共有

生成レス用のTTSは、KakeaiのJob APIを経由せず、TTSアダプタを直接呼ぶ。Jobは永続化と監査に向くが、ライブの即時生成には重い。

- `apps/api/src/tts`のアダプタ実装を`packages/tts`へ切り出し、`apps/api`と`apps/live`の両方から使う。
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

1. Kakeaiで作成したWork、ScriptVersion、Show Profileから、ライブパッケージを書き出せる。通常キューは`lineId`から解決され、ライブ専用キューは別に持つ。パッケージ内のファイル参照は相対URLで完結し、テーマ、キャラクター、静止/MP4素材カード、準備済み音声、参照音声を含む。フォントは同じMacのローカルフォントを使う。
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

## 非ゴール

- YouTubeの配信作成・開始・終了、タイトル・説明・サムネイル設定。
- YouTubeチャットへの投稿、削除、ピン留め、モデレーション。
- コンポジションのScene・Cue・タイムラインをライブの進行に使うこと。
- HyperFrames Playerをライブのステージの進行に使うこと。
- 素材カードをiframe内のコンポジションタイムラインで動かすこと。
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
