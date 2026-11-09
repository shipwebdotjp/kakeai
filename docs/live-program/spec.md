# ライブプログラム台本とライブカード

Status: accepted. Live Program とパッケージv2がライブの唯一の契約である。

[ADR-0131](../adr/0131-live-program-owns-live-script.md) と [ADR-0132](../adr/0132-live-cards-typed-state-renderer.md) を正とする。この仕様は、ライブ配信の台本を動画用の Work / Script Version から切り離し、ライブ専用の **Live Program** として持つための契約を定める。

[../live/spec.md](../live/spec.md) のステージ、プレイアウト、コメントコーナー、CutIn、TTS の実行契約は、この仕様のパッケージv2を前提とする。Work / Script Version を入力にする旧経路は削除済みである（[ADR-0134](../adr/0134-live-program-v2-only.md)）。

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
- `materials` は、プログラムが所有する **Live Material** のIDを参照する。Live MaterialはWorkのSceneを継続参照せず、取り込み時にScene内容、依存Asset、出力形式（`png` / `html` / `mp4`）とMP4の尺をコピーしたスナップショットとする。Work ID / Scene IDは来歴にだけ残す。
- `cutIns` は ready な動画 Asset を参照する。既存の CutIn 契約をそのまま使う。
- `theme` はテーマIDと版を固定する。
- `cast.left` は必須、`cast.right` は `null` を許可する。右が `null` のとき、右話者のCueを版確定時に拒否する。
- `stageTemplate` は現行では `"news-desk"` だけを許可する。複数レイアウトが必要になった時点で `{ id, version }` のレジストリへ拡張する。
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
  - Characterの外観（expression / pose / 立ち位置のscale・edge・vertical）・Face Set・各画像Assetのハッシュ
  - Voice Profileの解決済み設定・参照音声のハッシュ
  - `audioAssetId` のRendition・ハッシュ
  - CutInの入力Asset/Rendition・ハッシュ
  - 参照されたカード画像AssetのIDとハッシュ（`cardAssets[]`。各要素は `assetId` とAssetスナップショットを持つ）
  - Live MaterialのSceneスナップショット、出力形式・尺、依存Assetのハッシュ
- カード画像Assetは、版が実際に参照するカードの状態だけを `cardAssets[]` に固定する。版確定後にAssetが差し替えられた場合、書き出しはスナップショットとの不一致で失敗する。
- 書き出しと配信開始は、必ず確定済みの版を指定する。下書きから直接書き出さない。書き出し時に自動で版を切る操作を許す。
- 書き出しAPIは `programVersionId` と `outDir` を受け取る。Work / Script Version / 旧 Show Profile は受け付けない。旧形式の入力経路は存在しない。
- 同じ版から再書き出しすると新しい **package build** になる。過去のbuildはそのまま再生できる。
- package buildは既存の `packageId`、`manifestSha256`、`packagePath` で識別する。別のbuildエンティティは作らない。これらは不変のパッケージとmanifestハッシュで一意に参照できる。
- `packageId` は版IDと書き出しJobのbuild IDから作り、同じ版の再書き出しでも再利用しない。`outDir` は存在しないディレクトリに限り、既存のbuildを上書きしない。
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
- `materialId` と `segment.material` は持たない。素材は必ず `visual` で参照する。

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

中央スロットは `StageState.visual` の単一参照で表す。`StageState.material` は持たない。カードと素材を両方持つ遷移状態は作らない。

```ts
type StageVisualState =
  | { kind: "card"; cardId: string; stateId: string; sequence: number }
  | { kind: "material"; materialId: string; focus: boolean; sequence: number }
  | null;
```

- 実効Visualの継承、カード状態の存在確認、カード切替の判定はサーバー側で行う。ブラウザはパッケージの定義を参照して描画する。
- `sequence` は実効Visualの識別子（cardId/stateId、materialId/focus、または非表示）が変わったときだけ増やす。同じVisualを再送しても増やさない。
- サーバーは常に現在の `sequence` を送る。ステージは非nullの `visual.sequence` が直前に適用した値より小さい状態を無視し、古いカードへ戻らない。
- `visual: null` は中央スロットを隠し、カードと素材のどちらも表示しない。
- 初回マウント、preview、再接続では完成状態を即時描画し、アニメーションを再生しない。programステージの通常の状態更新だけがアニメーションする。
- 同一カードの状態変更だけ `update`、カードの新規表示だけ `enter` を使う。`visual: null` の後に再表示する場合も `enter` とする。
- カードの読み込み・描画失敗は中央スロットを隠して進行を継続する。programステージは `card_error` イベント（`cardId`・`stateId`・`error`、`sequence` はVisual sequence）を送る。サーバーはカード/状態/理由ごとに重複を抑えてRun logとコンソール通知に残す。

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

- `schemaVersion` は `2` だけとする。`1` は受け付けない。
- パッケージの `cues[].origin` は既存の実行契約との互換のため `live` を設定する。Live Program の文書自体は `origin` を持たない。
- `cards[]` と `cardAssets[]` は、参照されたカードと画像だけを含める。
- `segments[].visual` は、その Segment の既定ビジュアルである。
- `cues[].visual` は、その Cue の上書きである。未指定は Segment 既定、`null` は非表示。
- `materials[]` は、取り込んだ Live Material の解決済みカードである。ネイティブカードとは別の配列にする。
- Live Material のスナップショットは、取り込み時に選んだ `format`（`png` / `html` / `mp4`）と `durationMs` を持つ。`png` と `html` の `durationMs` は常に 4000 として保存する。書き出し時は `materials/card-NNNN.png`、`materials/card-NNNN.html`、`materials/card-NNNN.mp4` のいずれかを作る。
- `png` と `html` は 4000ms の静止カードとして扱う。`html` はスクリプトなしの静的HTMLで、参照する画像は `media/assets/` に `kind: "asset"` でコピーし、HTMLからは `../media/assets/...` の相対URLで参照する。`mp4` は 1920x1080・30fps・無音で、`durationMs`（既定4000ms、最大30000ms）の長さにレンダーし、実際の尺を probe して `show.json` と `manifest.json` に記録する。
- `materialId` と `segment.material` は使わない。strict schema がこれらを拒否する。
- `cards[].id`、`cardAssets[].id` はそれぞれ一意とする。
- `visual` は実在するカードと状態、または素材を指さなければならない。
- 画像カードの `assetId` は `cardAssets[]` に存在しなければならない。
- `cardAssets[]` のファイルは `manifest.json` に `kind: "card-asset"` で記録し、SHA-256、byteSize、mediaType、寸法を持つ。
- カード定義とカード画像はパッケージに含め、ライブ実行時にKakeaiのDBを読まない。
- カードの描画に必要なレンダラーは `apps/live` に含める。パッケージはレンダラーのコードを含めない。
- `commentSource`、`test.fixture`、`startAt` は Live Run の設定であり、`show.json` には含めない。strict schema がこれらのフィールドを拒否する。fixture ファイルを同梱しても `commentSource` / `test` / `show.startAt` を書かない。

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

- `packageSchemaVersion` は `2` だけとする。`source` は Live Program のIDと版、文書ハッシュ、解決スナップショットのハッシュを持つ。v1 の Work 由来 `source` は受け付けない。
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
    "liveChatId": null
  },
  "startAt": "2026-11-15T10:00:00.000Z",
  "requestedPort": 3010,
  "status": "preparing",
  "launchedAt": null,
  "endedAt": null,
  "control": {
    "url": "http://127.0.0.1:3010",
    "tokenRef": "/.../runs/run_.../control-token",
    "pid": null
  },
  "logDir": "/.../runs/run_...",
  "failure": null,
  "state": { "ready": false, "showStarted": false, "showEnded": false, "phase": null }
}
```

- `source` は `youtube` または `fixture` とする。YouTube は `videoUrl` または `liveChatId` のどちらかを必須とする。`fixture` の場合はRunディレクトリ内の `fixtures/comments.json` とSHA-256を固定する。
- fixtureはRun作成時にRunディレクトリへコピーし、ハッシュをRunへ固定する。ProgramやPackageを書き換えない。fixture入力は既存ファイルのパスでも、APIへ渡すコメント配列でもよい。
- 認証情報、LLM/TTS接続先はローカルLive設定に残し、Run/Packageに保存しない。
- package buildは `packageSchemaVersion: 2` かつ、manifestの `source.programVersionId`、`programDocumentSha256`、`resolutionSnapshotSha256` が指定した版と一致しなければならない。manifestの実ハッシュと `manifestSha256` も一致を検証する。
- KakeaiはRun IDと一回限りのcontrol tokenを指定して `apps/live` をdetachedで起動する。
- Live appはloopback限定のhealth/control endpointで、ready、URL、状態、終了、障害を返す。
- Kakeai再起動時は既存のLive appへ再接続するだけにする。Live appが死んでいた場合は自動復元・自動再生をせず、Runを失敗として明示する。
- detached起動でも、PID、control URL、token参照、package build、Run logの場所をRunに記録する。
- 「アプリ起動」と「番組開始」を分ける。番組開始はコンソールで行う。


### 状態と遷移

| 状態 | 意味 |
| --- | --- |
| `preparing` | Runを作成済み。package検証とfixtureコピーが終わり、まだ起動していない。 |
| `launching` | control tokenを発行してdetached起動を要求し、PIDを記録した。control endpointはまだ応答していない。 |
| `running` | アプリは稼働中。番組開始前でも `running` とし、開始済みかどうかは `state.showStarted` で表す。 |
| `ended` | 番組が `post_show` に到達した。 |
| `stopped` | オペレーターまたはAPIが停止した。 |
| `failed` | 起動失敗、プロセス終了、control到達不能、またはcontrolが失敗を報告した。 |

- `preparing` → `launching` → `running` → `ended` / `stopped` / `failed`。
- `preparing` から直接 `stopped` / `failed` もありうる。
- `stopped` / `failed` / `ended` は終端で、`running` へ戻さない。
- 二重起動は409 `LIVE_RUN_ALREADY_LAUNCHED` で拒否する。再試行は新しいRunを作る。

### control tokenとrun config

- launch時に32バイトのランダムtokenを生成し、`<runDir>/control-token` へ `0600` で書く。DBとDTOには `control.tokenRef`（パス）だけを保存し、token値は保存・返却しない。
- control endpointは `Authorization: Bearer <token>` を要求し、定数時間比較で検証する。tokenがない手動 `npm run live` では `/control/*` を404にし、通常のステージ・コンソールはそのまま動かす。
- `<runDir>/run-config.json` は次の内容だけを持つ。LLM/TTS/YouTubeの認証情報は含めない。

```jsonc
{
  "schemaVersion": 1,
  "runId": "run_...",
  "programVersionId": "prgv_...",
  "package": { "packageId": "livepkg-...", "manifestSha256": "<64 hex>", "packagePath": "/..." },
  "source": {
    "kind": "fixture",
    "fixturePath": "/.../runs/run_.../fixtures/comments.json",
    "fixtureSha256": "<64 hex>"
  },
  "startAt": "2026-11-15T10:00:00.000Z",
  "requestedPort": 3010
}
```

- `apps/live` は `--run-id`、`--package`、`--port`、`--control-token-file`、`--run-config`、`--run-dir` を受け取る。
- ステージ・コンソールの `startAt` は run config から渡す。`show.json` は開始時刻を持たない。
- `commentSource` / `test.fixture` は run config の `source` だけを使う。`show.json` からは読まない。

### control endpoint

| メソッド | パス | 内容 |
| --- | --- | --- |
| `GET` | `/control/status` | `{ ok, runId, ready, stageUrl, consoleUrl, status, phase, showStarted, showEnded, startedAt, failure }` を返す。 |
| `POST` | `/control/stop` | 番組を止めてアプリの終了を要求する。`{ ok: true, status: "stopped" }`。 |

- どちらもloopbackのHostだけを受け付け、tokenが無い・違う場合は401、非loopbackは403。
- `status` は `starting`、`ready`、`running`、`ended`、`stopped`、`failed` のいずれか。`ready` はアプリが応答可能で番組未開始、`running` は番組開始済みを表す。
- 起動直後の検出は `launching` のままcontrolをポーリングし、応答があれば `running` にする。起動から30秒以内はcontrol未応答でも `launching` を維持する。
- controlが到達不能でもプロセスが生きている場合は `failed`（`control_unreachable`）、プロセスが死んでいる場合は `failed`（`process_exited`）とし、再起動も自動再生もしない。

## APIと同時編集

APIは `/api/v1` 配下に置き、成功は `{ "data": ... }`、失敗は `{ "error": { code, message, requestId, details? } }` で返す。

### Live Format

| メソッド | パス | 内容 |
| --- | --- | --- |
| `GET` | `/live-formats` | 一覧（更新日時の降順）。`?limit=1..500&offset=...` を受け付け、`{ items, limit, offset, total }` を返す。summaryは `id`、`name`、`title`、`locale`、`targetDurationMs`、`segmentCount`、`cardCount`、`createdAt`、`updatedAt`。 |
| `POST` | `/live-formats` | 作成。bodyは `{ "document": LiveFormatDocumentV1 }`。201。 |
| `GET` | `/live-formats/:id` | summaryに `document` を加えたdetail。 |
| `PATCH` | `/live-formats/:id` | 更新。bodyは作成と同じ `{ "document": LiveFormatDocumentV1 }`。 |
| `POST` | `/live-formats/:id/duplicate` | 複製。bodyは `{ "name"?: string }`。201。 |

Formatの更新は既存Programへ反映しない。Programは作成時の `sourceFormat`（formatIdとformatUpdatedAt）だけを来歴として持つ。

### Live Program

| メソッド | パス | 内容 |
| --- | --- | --- |
| `GET` | `/live-programs` | 一覧。`?limit=1..500&offset=...` を受け付け、`{ items, limit, offset, total }` を返す。summaryは `id`、`title`、`draftRevision`、`sourceFormat`、`versionCount`、`latestVersionNumber`、`createdAt`、`updatedAt`。 |
| `POST` | `/live-programs` | 作成。bodyは `{ "formatId": string, "title"?: string }`。Formatを深くコピーし、Segment / Card / State / CueのIDを新規採番する。201。 |
| `GET` | `/live-programs/:id` | `draftDocument`、`draftRevision`、`sourceFormat`、`versions`（summary配列）を含むdetail。 |
| `PUT` | `/live-programs/:id/draft` | 下書き全体の置換。bodyは `{ "expectedRevision": number, "document": LiveProgramDocument }`。成功時は更新後のProgram detail。 |
| `POST` | `/live-programs/:id/versions` | 版確定。bodyは `{ "expectedRevision": number, "note"?: string }`。201で `LiveProgramVersionDetail`。 |
| `GET` | `/live-programs/:id/versions` | 版summaryの配列（versionNumberの降順）。 |
| `GET` | `/live-programs/:id/versions/:versionId` | `document` と `resolutionSnapshot` を含む版detail。 |
| `POST` | `/live-programs/:id/versions/:versionId/draft` | 版を下書きへ複製編集。bodyは `{ "expectedRevision": number }`。下書きのrevisionを進めるだけで、版は変更しない。 |

`LiveProgramDetail.draftDocument` と `LiveProgramVersionDetail.document` を並べることで、UIは差分を永続化せずに表示できる。版には更新・削除のAPIを置かない。

### Live Run

| メソッド | パス | 内容 |
| --- | --- | --- |
| `GET` | `/live-runs` | 一覧（作成日時の降順）。`?limit=1..500&offset=...` を受け付け、`{ items, limit, offset, total }` を返す。各itemは `LiveRun` DTO。 |
| `POST` | `/live-runs` | Run作成。bodyは `{ programVersionId, packageBuild, source, startAt?, requestedPort? }`。201で `LiveRun`（`status: "preparing"`）。 |
| `GET` | `/live-runs/:id` | `LiveRun` DTO。起動済みならcontrol endpointへ再接続して状態を更新する。 |
| `POST` | `/live-runs/:id/launch` | control tokenを発行し、`apps/live` をdetached起動する。202で `LiveRun`。二重起動は409。番組は開始しない。 |
| `POST` | `/live-runs/:id/stop` | control endpointへ停止を要求し、必要ならPIDを終了する。200で `LiveRun`（`status: "stopped"`）。 |

- `packageBuild` は `{ packageId, manifestSha256, packagePath }`。v2 manifestの実ハッシュ、`packageId`、`source` の版IDと2つのハッシュが一致しなければ422 `LIVE_RUN_PACKAGE_INVALID`。
- `source` は `{ kind: "youtube", videoUrl?, liveChatId? }` または `{ kind: "fixture", fixturePath? }` / `{ kind: "fixture", comments? }`。fixtureは作成時に `<runDir>/fixtures/comments.json` へコピーされ、SHA-256が `source.fixtureSha256` に固定される。
- `LiveRun` DTOは `id`、`programVersionId`、`packageBuild`、`source`、`startAt`、`requestedPort`、`status`、`control: { url, tokenRef, pid }`、`stageUrl`、`consoleUrl`、`logDir`、`failure`、`state`、`launchedAt`、`endedAt`、`createdAt`、`updatedAt` を持つ。token値は含まない。
- `GET` はプロセスが死んでいる、またはcontrolへ接続できない場合に `failed` として記録し、再起動も自動再生もしない。`process_exited` と `control_unreachable` を区別する。
- `stop` はcontrolの `POST /control/stop` を呼び、応答しない場合もPIDへSIGTERM/SIGKILLを送る。ログは削除しない。

### 同時編集とエラー

- 下書き保存と版確定は `draftRevision` による楽観ロックを使う。期待revisionが一致しない場合はHTTP 409、code `LIVE_PROGRAM_REVISION_CONFLICT`、details `{ programId, currentRevision, currentDocument }` を返す。
- 版確定は期待revisionの確認、文書検証、DB参照検証、resolutionSnapshotの生成、版のinsertを単一トランザクションで行う。下書きは変更しない。
- 版確定の文書・参照検証はHTTP 422、code `VALIDATION_ERROR`、details `{ issues: [{ path, code, message }] }` を返す。
- 存在しないFormat / Program / Version / Work / SceneはHTTP 404、code `RESOURCE_NOT_FOUND`。
- 存在しないAssetはHTTP 422 `ASSET_NOT_FOUND`、readyでないAssetはHTTP 422 `ASSET_UNAVAILABLE`。
- `audioAssetId` が実在しない、またはreadyなRenditionを持たない場合は版確定を失敗させる。TTSへはフォールバックしない。

### Live Material

| メソッド | パス | 内容 |
| --- | --- | --- |
| `GET` | `/live-programs/:id/materials` | Program所有のLive Material一覧。`?limit=1..500&offset=...` を受け付け、`{ items, limit, offset, total }` を返す。summaryは `id`、`programId`、`name`、`provenance`（`workId`、`sceneId`、`importedAt`）、`createdAt`。 |
| `POST` | `/live-programs/:id/materials/import` | WorkのSceneを取り込む。bodyは `{ "expectedRevision": number, "workId": string, "sceneId": string, "name"?: string, "format"?: "png" \| "html" \| "mp4", "durationMs"?: number }`。`format` の既定は `"png"`、`durationMs` の既定は `4000`（1〜30000ms、`mp4` のみ有効。`png` / `html` は常に4000として保存）。201で `{ material: LiveMaterialDetail, program: LiveProgramDetail }`。 |

取り込みはScene内容、依存画像Assetのハッシュ、出力形式とMP4の尺を `LiveMaterial` にスナップショットとして保存し、Program文書の `materials[]` にはIDと名前だけを追加する。Work ID / Scene IDは `provenance` にだけ残り、Program文書からは参照しない。取り込みも下書き更新なので `draftRevision` の楽観ロックに従う。

## 移行

- 旧 Show Profile JSON、`live-profiles` API、`live:export` の `--profile` / `--auto-profile`、Work / Script Version 由来の v1 パッケージ書き出し・読み込みは P7 で削除した（[ADR-0134](../adr/0134-live-program-v2-only.md)）。
- `manifest.json` の `packageSchemaVersion` は `2`、`show.json` の `schemaVersion` は `2` だけを受け付ける。v1 の manifest/show、`materialId`、`segment.material`、`commentSource`、`test`、`show.startAt` は読み込み時に拒否する。
- `live:export` は `--program-version`、`--fixture`、`--out`、`--timeout-ms`、`--interval-ms`、`--help` だけを受け付ける。
- Work からライブ台本へ内容を移す機能が必要になった場合は、版や参照を保持しない一度限りのインポータとして別途設計する。互換経路としては残さない。
- [../live/spec.md](../live/spec.md) のステージ、プレイアウト、コメント、CutIn、TTS の契約は、パッケージv2を前提に引き続き有効とする。

## エディタGUI（P3）

- `/live-programs` はプログラム一覧、`/live-programs/new` はフォーマット選択とタイトル入力の作成ウィザード、`/live-programs/:programId` はエディタである。
- エディタは動画タイムラインではなく、セグメント順のスパインを左、選択セグメントのCueを中央、プレビュー・カード・素材/CutIn・版・差分・設定を右に置く。
- 下書きは自動保存せず、明示的な保存だけが `PUT /live-programs/:id/draft` を `expectedRevision` 付きで呼ぶ。409では最新の下書きを読み込むかどうかを確認する。
- Cueの `visual` は「継承（未指定）」「非表示（`null`）」「カード状態」「素材」をUIで区別する。プレビューは `@kakeai/live-cards` をShadow DOMへマウントし、初回は完成状態で描画する。
- 版確定は保存済みの下書きだけを対象にし、422の検証issueを表示する。版一覧から版を下書きへ複製でき、版と現在の下書きの構造差分をUI側で算出して表示する。
- フォーマット編集画面は、変更が既存プログラムへ反映されないことを明示する。

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
