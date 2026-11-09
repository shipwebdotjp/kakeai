# ライブプログラム台本とライブカード

Status: accepted for contracts (P0/P1 schema). DB/API/UI/runtime are in progress; `packages/contracts` contains the Live Program document, card/state, animation, and package-v2 contracts.

[ADR-0131](../adr/0131-live-program-owns-live-script.md) と [ADR-0132](../adr/0132-live-cards-typed-state-renderer.md) を正とする。この仕様は、ライブ配信の台本を動画用の Work / Script Version から切り離し、ライブ専用の **Live Program** として持つための契約を定める。

既存の [../live/spec.md](../live/spec.md) のうち、Show Profile を入力にする部分はこの仕様で置き換える。ステージ、プレイアウト、コメントコーナー、CutIn、TTS の実行契約は、Live Program のパッケージ v2 へ移行するまで引き続き有効とする。

## 用語

- **Live Format**: 番組の再利用可能なプリセット。セグメントの骨格、キャスト、ステージ、テーマ、コメント・安全・プレイアウトの既定値、任意の定型カードを持つ。
- **Live Program**: 1回の配信に対応するライブ台本。セグメント、Cue、カード、素材、CutIn、ポリシーを所有する。
- **Live Program Version**: Live Program の不変スナップショット。書き出しと配信開始はこの版から行う。
- **Live Card**: ライブ用の型付きカード。見出し、画像、リスト、グラフ、引用のいずれか。
- **Live Card State**: あるCueで表示するカード内容の完全なスナップショット。
- **Visual Ref**: 中央スロットに出すものを表す単一の参照。`{ kind: "card", cardId, stateId }`、`{ kind: "material", materialId }`、または `null`。
- **Live Material**: WorkのSceneから取り込んだ、ライブ側が所有する素材カードのスナップショット。
- **Live Package**: Live Program Version から書き出した不変の実行物。`show.json`、カード定義、カード画像、テーマ、キャラクター、素材、CutIn、音声を含む。
- **Live Run**: 1回の配信実行。どのパッケージを使い、どのコメントソース・fixture・開始時刻・ポートで動かしたかを固定する。

## 全体の流れ

1. Live Format を選び、Live Program を作成する。フォーマットの内容は作成時にコピーする。
2. Live Program の下書きを編集する。
3. 版を確定し、Live Program Version を作る。
4. 版から Live Package を書き出す。
5. 書き出したパッケージを使う Live Run を作成し、ライブアプリを起動する。

フォーマットの変更は、以後に作成する Live Program にだけ影響する。既存の版へ自動反映しない。必要な場合はフォーマット更新の差分適用を別途行う。

## Live Program の文書

Zodの正本は `packages/contracts/src/live/program.ts` の `liveProgramDocumentSchema` とする。`schemaVersion` は固定で `1` とする。

```jsonc
{
  "schemaVersion": 1,
  "title": "今週のニュース",
  "locale": "ja-JP",
  "targetDurationMs": 1800000,
  "stageTemplate": "news-desk",
  "theme": { "id": "theme-news", "version": 3 },
  "sourceFormat": {
    "formatId": "format-news-30m",
    "formatUpdatedAt": "2026-11-01T00:00:00.000Z"
  },
  "cast": {
    "left": { "characterId": "char-left", "voiceProfileId": "voice-left" },
    "right": null
  },
  "segments": [
    {
      "id": "seg-opening",
      "kind": "opening",
      "label": "オープニング",
      "targetDurationMs": 120000,
      "cues": ["cue-opening"]
    },
    {
      "id": "seg-news",
      "kind": "script",
      "label": "ニュース",
      "targetDurationMs": 480000,
      "cues": ["cue-news-1", "cue-news-2"]
    },
    {
      "id": "cut-comments",
      "kind": "cut_in",
      "label": "コメントコーナーへ",
      "cutInId": "jingle-comments"
    },
    {
      "id": "seg-comments",
      "kind": "comment",
      "label": "コメント",
      "targetDurationMs": 300000,
      "commentPolicy": { "maxCommentsPerCorner": 2 }
    },
    {
      "id": "seg-closing",
      "kind": "closing",
      "label": "クロージング",
      "targetDurationMs": 120000,
      "cues": ["cue-closing"]
    }
  ],
  "cues": [
    {
      "id": "cue-opening",
      "speaker": "left",
      "caption": "今週も始まりました。",
      "speech": "こんしゅうも はじまりました。",
      "expression": "smile"
    },
    {
      "id": "cue-news-1",
      "speaker": "left",
      "caption": "今日のポイントは3つです。",
      "speech": "きょうの ぽいんとは みっつです。",
      "expression": "normal",
      "visual": { "kind": "card", "cardId": "card-points", "stateId": "state-title" }
    },
    {
      "id": "cue-news-2",
      "speaker": "left",
      "caption": "1つ目は、新しい取り組みです。",
      "speech": "ひとつめは、あたらしい とりくみです。",
      "expression": "smile",
      "visual": { "kind": "card", "cardId": "card-points", "stateId": "state-point-1" }
    },
    {
      "id": "cue-closing",
      "speaker": "left",
      "caption": "本日はここまでです。",
      "speech": "ほんじつは ここまでです。",
      "expression": "smile"
    },
    {
      "id": "cue-fallback",
      "speaker": "left",
      "caption": "少し補足します。",
      "speech": "すこし ほそくします。",
      "expression": "normal"
    }
  ],
  "cards": [
    {
      "id": "card-points",
      "type": "list",
      "animation": {
        "enter": { "preset": "fade", "durationMs": 400 },
        "update": { "preset": "slide-up", "durationMs": 300, "staggerMs": 120 }
      },
      "states": [
        {
          "id": "state-title",
          "title": "今日のポイント",
          "items": []
        },
        {
          "id": "state-point-1",
          "title": "今日のポイント",
          "items": [
            { "id": "item-1", "text": "新しい取り組み" },
            { "id": "item-2", "text": "地域の変化" },
            { "id": "item-3", "text": "来週の予定" }
          ],
          "activeItemId": "item-1"
        }
      ]
    }
  ],
  "materials": [
    { "id": "material-news-1", "name": "ニュース図版" }
  ],
  "cutIns": [
    { "id": "jingle-comments", "assetId": "asset-video-jingle" }
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
    "persona": "親しみやすいニュース解説キャラクター。",
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

- Cue は Script Version の行を参照しない。`lineId` を持たない。
- `caption`、`speech`、`speaker`、`expression` は Cue 自身が持つ。
- `audioAssetId` を指定した場合、そのAssetを必ず使う。利用できなければTTSへ黙ってフォールバックせず、版確定または書き出しを失敗させる。`speech` は音声Asset利用時も必須とする。
- `segments[].cues` は Cue ID の順序を持つ。草稿では空配列を許すが、版を確定するときは各 `opening` / `script` / `closing` に1つ以上の Cue を要求する。
- `safety.fallbackCueId` は、通常のスパインに属さない専用Cueを指す。オープニングやクロージングを退避キューに流用しない。
- `commentSource`、`test.fixture`、`startAt`、LLM/TTS接続設定、ポートは台本ではなく Live Run の設定とする。
- `materials` は、プログラムが所有する **Live Material** のIDを参照する。Live MaterialはWorkのSceneを継続参照せず、取り込み時にScene内容と依存Assetをコピーしたスナップショットとする。Work ID / Scene IDは来歴にだけ残す。
- `cutIns` は ready な動画 Asset を参照する。既存の CutIn 契約をそのまま使う。
- `theme` はテーマIDと版を固定する。
- `cast.left` は必須、`cast.right` は `null` を許可する。右が `null` のとき、右話者のCueを版確定時に拒否する。
- `stageTemplate` はv1では `"news-desk"` だけを許可する。複数レイアウトが必要になった時点で `{ id, version }` のレジストリへ拡張する。
- `comment` Segmentの `commentPolicy` は、プログラム全体のポリシーへの部分上書きとする。

### 草稿検証と版確定検証

検証を二層に分ける。

- **草稿検証**: JSON形状、ID重複、型、カード・素材・CutInの基本参照を確認する。空のセグメント、未完成のCue、未設定のsafetyを許容する。`liveProgramDocumentSchema` が行う。
- **版確定検証**: スパイン、参照、キャスト、退避キュー、音声Asset、Live Materialなど、本番実行可能性を確認する。`validateLiveProgramDocumentForVersion` とAPIサービスが行う。

版確定時の検証項目:

- Segment ID、Cue ID、Card ID、State IDは各スコープで一意。
- 最初のSegmentは唯一の `opening`、最後は唯一の `closing`。
- `script` を少なくとも1つ含む。
- `cut_in` は `opening` と `closing` の間だけに置く。
- 通常Cueはちょうど1つのCue Segmentに属する。退避CueはどのSegmentにも属さない。
- `cast.right` が `null` のとき、右話者のCueがない。
- `playout.closingReserveMs < targetDurationMs`。
- `audioAssetId` が実在し、readyな音声Renditionを持つ。
- 画像カードの `assetId` が実在する。`collectLiveProgramAssetReferences` でカード画像・音声・CutInのAssetを列挙して検証する。
- Live Material、CutIn、テーマ、キャスト、Voice Profileが実在する。
- Segment目標尺の合計が全体目標尺と大きくずれる場合は警告を表示する。エラーにはしない。

### 版と解決スナップショット

- `LiveProgram` は下書きを持ち、`draftRevision` で楽観ロックする。
- `LiveProgramVersion` は不変で、`programId`、`versionNumber`、`schemaVersion`、canonical JSON、`documentSha256`、作成日時、任意のメモを持つ。
- 版確定時に、文書とは別に **resolutionSnapshot** を固定する。文書ハッシュは保存時に計算し、書き出し時に初めて計算しない。
- resolutionSnapshot に含めるもの:
  - Theme revision
  - Characterの外観・Face Set・各画像Assetのハッシュ
  - Voice Profileの解決済み設定・参照音声のハッシュ
  - `audioAssetId` のRendition・ハッシュ
  - CutInの入力Asset/Rendition・ハッシュ
  - Live MaterialのSceneスナップショットと依存Assetのハッシュ
- 書き出しと配信開始は、必ず確定済みの版を指定する。下書きから直接書き出さない。書き出し時に自動で版を切る操作を許す。
- 同じ版から再書き出しすると新しい **package build** になる。過去のbuildはそのまま再生できる。
- package buildは既存の `packageId`、`manifestSha256`、`packagePath` で識別する。別のbuildエンティティは作らない。これらは不変のパッケージとmanifestハッシュで一意に参照できる。
- `LiveRun` は版だけでなく、必ず正確なpackage buildを参照する。

### フォーマット

- Live Format は Live Program とは別スキーマ `LiveFormatDocumentV1` とする。
- 持てるもの: ステージ、テーマ、キャスト、スパイン雛形、コメント・安全・プレイアウト既定値、定型カード、汎用のopening/closing/fallback Cue。
- 持てないもの: エピソード本文、Live Material、CutIn。
- 作成時に深いコピーを行い、Segment / Card / State / CueのIDを新規採番する。
- フォーマットの変更は既存Programに一切反映しない。Programには作成元FormatのIDと更新時刻を `sourceFormat` として残すだけにする。

## カード契約

### 型

カードは次の5型とする。

| 型 | 用途 | 主な内容 |
| --- | --- | --- |
| `headline` | 見出し | タイトル、サブタイトル、キッカー、トーン、揃え |
| `image` | 画像 | Asset ID、代替テキスト、キャプション、クレジット、フィット |
| `list` | 箇条書き | タイトル、項目、アクティブ項目、番号付き |
| `chart` | グラフ | 棒/折れ線、カテゴリ、系列、値、単位、強調 |
| `quote` | 引用 | 引用文、著者、出典、トーン、揃え |

Zodの正本は `packages/contracts/src/live/card.ts` とする。

### 状態スナップショット

- カードは `states[]` を持ち、各状態は**その時点で表示する内容の完全なスナップショット**である。差分パッチではない。
- 状態は `id` を持ち、カード内で一意でなければならない。
- Cue / Segment は `visual` でカード状態または素材を参照する。
- 同じ `cardId` が続く場合、レンダラーはカードを維持したまま状態を更新する。
- `cardId` が変わる場合、カードを差し替える。
- リスト項目、グラフの系列・カテゴリは安定したIDを持つ。状態間で同じIDを使うことで、レンダラーは追加・更新・削除だけを適用できる。

### リスト

- `items[]` は、その状態で表示する項目の集合である。空配列は「項目をまだ出していない」状態を表す。
- `activeItemId` は、その状態で強調する項目を指す。項目に存在しないIDは拒否する。
- 項目IDは状態をまたいで同じものを使う。新しい項目を追加する状態では、その項目を `items[]` に追加する。
- 項目の本文は状態ごとに持つ。エディタは前の状態を複製して編集する。

### グラフ

- `variant` は `bar` または `line` で、カード単位に固定する。
- `categories[]` は `{ key, label }` を持ち、キーはカード状態内で一意とする。
- `series[]` は `{ key, label, values, tone? }` を持ち、`values` はカテゴリキーから数値へのマップとする。
- すべてのカテゴリキーに値が必要で、存在しないカテゴリキーの値は拒否する。
- `highlight.seriesKeys` と `highlight.categoryKeys` は実在するキーだけを参照できる。
- `chartAnimation` は `none`、`grow`、`draw` のいずれかとする。未指定なら棒は `grow`、折れ線は `draw` を既定とする。

### 画像

- `assetId` はカード画像のAssetを参照する。
- パッケージでは `cardAssets[]` が `assetId` をパッケージ相対ファイルへ解決する。
- `width`、`height`、`mediaType` は書き出し時に確定する。
- 画像Assetは `image/png`、`image/jpeg`、`image/webp` のいずれかとする。

## 中央ビジュアル契約

中央スロットに出すものは、カードと素材を別フィールドで持たず、単一の `visual` で表す。

```ts
type VisualRef =
  | { kind: "card"; cardId: string; stateId: string }
  | { kind: "material"; materialId: string };

type VisualField = VisualRef | null | undefined;
```

- Cueの `visual` が未指定なら、Segmentの `visual` を継承する。
- Cueの `visual` が `null` なら、中央スロットを隠す。
- Cueの `visual` が `card` / `material` なら、そのCueで明示的に表示する。
- Segmentの `visual` も未指定なら、中央スロットを表示しない。
- `card` と `material` を同時に指定する表現は持たない。優先順位の問題を型レベルで消す。
- `comment` SegmentはSegment既定の `visual` だけを持てる。コメントカードは中央スロットとは別レイヤーなので、中央の話題カードと併存できる。
- v1パッケージの `materialId` は、v2へ読み込む際に `visual: { kind: "material", materialId }` へ変換する。

## アニメーション契約

```jsonc
{
  "animation": {
    "enter": { "preset": "fade", "durationMs": 400, "delayMs": 0, "staggerMs": 0 },
    "update": { "preset": "slide-up", "durationMs": 300, "delayMs": 0, "staggerMs": 120 }
  }
}
```

- `enter`: カードが表示されたときに一度だけ再生する。
- `update`: 同じカードの状態が変わったときに、追加・変更された要素へ適用する。
- プリセットは `none`、`fade`、`slide-up`、`slide-down`、`slide-left`、`slide-right`、`scale-in` とする。
- `durationMs` と `delayMs` は 0〜5000ms、`staggerMs` は 0〜1000ms とする。
- グラフは `chartAnimation` で `none`、`grow`、`draw` を選ぶ。
- 同じ状態が連続する場合は何もしない。
- カードを切り替えた場合は、前のカードを隠し、新しいカードの `enter` を再生する。
- `visual: null` で隠した場合は、次に表示されたときに `enter` を再生する。
- 一時停止・再開ではアニメーションを巻き戻さない。再開後に状態が変わった場合だけ `update` を適用する。
- 初回マウント、preview、再接続ではアニメーションを再生せず、完成状態を即時描画する。
- `prefers-reduced-motion` が有効なら、アニメーションを即時完了させる。
- アニメーションは演出であり、音声・Cueの進行・コメントの処理を待たせない。
- Cue内の時間同期、シーク、一時停止、全体タイムラインは持たない。発話に合わせた項目の逐次表示は、将来の別契約とする。

## レンダラー契約

- レンダラーは `packages/live-cards`（実装時に追加）に置き、エディタのプレビューと `apps/live` のステージで共有する。
- レンダラーは `@kakeai/video` に依存しない。`@kakeai/contracts` と小さなテーマ・ヘルパー層だけに依存する。
- カードはホスト要素の **Shadow DOM** に描画する。カードCSSはShadow Root内に注入し、ステージのグローバルCSSと衝突させない。
- テーマのCSS変数はホストからShadow Rootへ継承される。色、フォント、余白はテーマに従う。
- レンダラーは `resolveAsset(assetId)` を受け取る。エディタはアプリのURL、ステージはパッケージ相対URLを返す。
- レンダラーは要素を安定IDで管理し、状態変更時にキー付き差分更新を行う。カード全体を作り直さない。
- 追加要素は `update` の入場、削除要素は退場、変更要素はクロスフェードの対象とする。
- カードの読み込みや描画に失敗した場合は、中央カードを隠す。音声、字幕、Cueの進行は止めない。
- 任意のHTML/JavaScriptをカードとして実行しない。カードは型付きデータだけを受け取る。

## ステージ状態契約

P5で `StageState.material` を `StageState.visual` へ置き換える。カードと素材を両方持つ遷移状態は作らない。移行中は既存の `material` を残し、P5で一括置換する。

```ts
type StageVisualState =
  | { kind: "card"; cardId: string; stateId: string; sequence: number }
  | { kind: "material"; materialId: string; focus: boolean; sequence: number }
  | null;
```

- 実効Visualの継承、カード状態の存在確認、カード切替の判定はサーバー側で行う。ブラウザはパッケージの定義を参照して描画する。
- `sequence` はビジュアル変更ごとに増やす。遅れて届いた状態で古いカードへ戻らないようにする。
- 初回マウント、preview、再接続では完成状態を即時描画し、アニメーションを再生しない。
- 同一カードの状態変更だけ `update`、カードの新規表示だけ `enter` を使う。
- 画像読み込み失敗は中央スロットを隠して進行を継続する。Run logとコンソールには重複を抑えた警告を残す。

## パッケージ契約

Live Program Version から書き出すパッケージは、`packageSchemaVersion: 2` とする。既存の `1` は Work 由来の移行用として残す。

### `show.json`

```jsonc
{
  "schemaVersion": 2,
  "show": {
    "title": "今週のニュース",
    "locale": "ja-JP",
    "targetDurationMs": 1800000,
    "stageTemplate": "news-desk",
    "theme": "theme.css",
    "characters": { "left": "char-left", "right": null }
  },
  "segments": [
    {
      "id": "seg-news",
      "kind": "script",
      "label": "ニュース",
      "targetDurationMs": 480000,
      "cues": ["cue-news-1"],
      "visual": { "kind": "card", "cardId": "card-points", "stateId": "state-title" }
    }
  ],
  "cues": [
    {
      "id": "cue-news-1",
      "origin": "live",
      "speaker": "left",
      "caption": "今日のポイントは3つです。",
      "speech": "きょうの ぽいんとは みっつです。",
      "expression": "normal",
      "visual": { "kind": "card", "cardId": "card-points", "stateId": "state-title" },
      "audio": "audio/prepared/cue-news-1.wav",
      "durationMs": 3200
    }
  ],
  "cards": [
    {
      "id": "card-points",
      "type": "list",
      "animation": { "...": "カード契約と同じ" },
      "states": [
        {
          "id": "state-title",
          "title": "今日のポイント",
          "items": []
        }
      ]
    }
  ],
  "cardAssets": [
    {
      "id": "asset-1",
      "file": "cards/asset-1.png",
      "mediaType": "image/png",
      "width": 1920,
      "height": 1080
    }
  ],
  "materials": [],
  "cutIns": [],
  "speakers": [],
  "commentPolicy": {},
  "safety": {},
  "playout": {}
}
```

- `schemaVersion` は `2` とする。`1` は既存の Work 由来パッケージ用である。
- パッケージの `cues[].origin` は既存の実行契約との互換のため `live` を設定する。Live Program の文書自体は `origin` を持たない。
- `cards[]` と `cardAssets[]` は、参照されたカードと画像だけを含める。
- `segments[].visual` は、その Segment の既定ビジュアルである。
- `cues[].visual` は、その Cue の上書きである。未指定は Segment 既定、`null` は非表示。
- `materials[]` は、取り込んだ Live Material の解決済みカードである。ネイティブカードとは別の配列にする。
- v2では `materialId` と `segment.material` を使わない。v1だけがこれらを持つ。
- `cards[].id`、`cardAssets[].id` はそれぞれ一意とする。
- `visual` は実在するカードと状態、または素材を指さなければならない。
- 画像カードの `assetId` は `cardAssets[]` に存在しなければならない。
- `cardAssets[]` のファイルは `manifest.json` に `kind: "card-asset"` で記録し、SHA-256、byteSize、mediaType、寸法を持つ。
- カード定義とカード画像はパッケージに含め、ライブ実行時にKakeaiのDBを読まない。
- カードの描画に必要なレンダラーは `apps/live` に含める。パッケージはレンダラーのコードを含めない。
- `commentSource`、`test.fixture`、`startAt` は最終的にLive Runへ移す。移行中のv2パッケージは現行ランタイムのためにこれらを残してよいが、P6で削除する。

### `manifest.json`

`packageSchemaVersion: 2` のマニフェストは、次の `source` を持つ。

```jsonc
{
  "source": {
    "programId": "prg_...",
    "programVersionId": "prgv_...",
    "programVersionNumber": 3,
    "programDocumentSha256": "<64 hex>",
    "resolutionSnapshotSha256": "<64 hex>",
    "theme": { "id": "theme-news", "version": 3 }
  },
  "cardSchemaVersion": 1
}
```

- `packageSchemaVersion: 1` は従来の `workId`、`languageEditionId`、`scriptVersionId`、`profileSha256` を持つ。
- `packageSchemaVersion: 2` は Live Program のIDと版、文書ハッシュ、解決スナップショットのハッシュを持つ。
- `cardSchemaVersion` は `1` とする。将来カード契約を破壊的に変える場合は上げる。
- ファイル種別に `card-asset` を追加する。
- `show.json` とカード画像は `files[]` に記録し、起動時にハッシュと参照を検証する。

### パッケージ検証

書き出し時とパッケージ読み込み時に、少なくとも次を検証する。

- カードID、カード状態ID、カード画像Asset IDの重複
- Cue / Segment の `visual` の解決
- 画像カードの `assetId` と `cardAssets[]` の対応
- `cardAssets[]` と manifest のファイル・ハッシュ・mediaType・寸法の対応
- `show.json` と manifest の `packageSchemaVersion` の一致
- カードスキーマ版の対応
- スパインの構造（opening / closing / script / cut_in / fallback）
- カード以外の既存検証（Cue、素材、CutIn、話者、フォント、音声）

## スパイン検証

版確定時とv2パッケージ読み込み時に、次を必須とする。

- Segment ID、Cue ID、Card ID、State IDは各スコープで一意。
- 最初のSegmentは唯一の `opening`、最後は唯一の `closing`。
- `script` を少なくとも1つ含む。
- `cut_in` は `opening` と `closing` の間だけに置く。
- 通常Cueはちょうど1つのCue Segmentに属する。
- 退避Cueは通常のスパインに属さない専用Cueとする。
- `closingReserveMs < targetDurationMs`。
- `cast.right` / `characters.right` が `null` のとき、右話者・右キャラクターのCueがない。
- Segment目標尺の合計と全体目標尺の大きなずれは警告として表示する。エラーにはしない。

## Live Run と起動

Live Runは、配信の実行設定を固定する運用スナップショットである。シークレットは含めない。

```jsonc
{
  "id": "run_...",
  "programVersionId": "prgv_...",
  "packageBuild": {
    "packageId": "livepkg-...",
    "manifestSha256": "<64 hex>",
    "packagePath": "/.../live-package"
  },
  "source": {
    "kind": "youtube",
    "videoUrl": "https://youtube.com/live/...",
    "liveChatId": "..."
  },
  "startAt": "2026-11-15T10:00:00.000Z",
  "requestedPort": 3010,
  "status": "preparing",
  "launchedAt": null,
  "endedAt": null,
  "control": {
    "url": "http://127.0.0.1:3010",
    "tokenRef": "run-token-...",
    "pid": null
  },
  "logDir": "/.../runs/run_..."
}
```

- `source` は `youtube` または `fixture` とする。`fixture` の場合はfixtureのSHA-256を固定する。
- fixtureはRun作成時にRunディレクトリへコピーし、ハッシュをRunへ固定する。ProgramやPackageを書き換えない。
- 認証情報、LLM/TTS接続先はローカルLive設定に残し、Run/Packageに保存しない。
- KakeaiはRun IDと一回限りのcontrol tokenを指定して `apps/live` を起動する。
- Live appはloopback限定のhealth/control endpointで、ready、URL、状態、終了、障害を返す。
- Kakeai再起動時は既存のLive appへ再接続するだけにする。Live appが死んでいた場合は自動復元・自動再生をせず、Runを失敗として明示する。
- detached起動でも、PID、control URL、token参照、package build、Run logの場所をRunに記録する。
- 「アプリ起動」と「番組開始」を分ける。番組開始はコンソールで行う。

## APIと同時編集

- 下書き保存は文書全体の置換とし、`draftRevision` による楽観ロックを使う。
- クライアントは保存時に期待revisionを送る。不一致は409で現行文書とrevisionを返す。
- 版確定は期待revisionを条件にした単一トランザクションで行う。
- 差分表示はAPIの永続形式にせず、Program文書の構造化比較としてUI側で表示する。

## 移行

- 既存のライブ用データはないものとして扱う。Show Profile JSON、`live-profiles` API、`live:export` の `--profile` / `--auto-profile` は、実装フェーズで置き換える。
- WorkのScript Versionからライブ台本を作る機能は、必要なら「一度だけコピーするインポータ」として残す。参照を保持しない。
- 既存のWork由来パッケージv1は、移行期間中だけ読み込めるようにする。v2の実装後はv1の書き出しを停止する。
- `docs/live/spec.md` のステージ、プレイアウト、コメント、CutInの契約は、v2の実装で必要な部分だけ更新する。

## 非ゴール

- Cue内の単語・文単位の時間同期
- 自由なキーフレームを持つタイムライン編集
- 任意のHTML/JavaScriptの実行
- 動画用Visual Templateのレンダラー共有
- ライブ中の外部データによるカード内容の自動更新
- YouTubeの配信作成・開始・チャット投稿
- 複数解像度・縦型ステージ

## 決定との対応

- ライブ台本をWork / Script Versionから独立させる: [ADR-0131](../adr/0131-live-program-owns-live-script.md)
- カードを型付き状態スナップショットとライブ専用DOMレンダラーで描く: [ADR-0132](../adr/0132-live-cards-typed-state-renderer.md)
- 版の解決スナップショットと不変のpackage build: [ADR-0133](../adr/0133-live-version-resolution-snapshot.md)
- ライブ実行系を分離し、パッケージで受け渡す: [ADR-0120](../adr/0120-live-runtime-separate-from-composition.md)
- 素材カードの静的/MP4制約: [ADR-0126](../adr/0126-live-material-cards-static-or-mp4.md)
- CutInの分離: [ADR-0130](../adr/0130-live-cut-in-separate-from-cues-and-materials.md)
