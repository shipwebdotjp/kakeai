# P1 実装プラン: ライブ契約とパッケージ書き出し

[spec.md](./spec.md) を正とする。この文書は P1 の作業順、契約、テスト、未決事項を実装可能な粒度に落としたもの。仕様と衝突する場合は spec を優先し、判断を変える場合は spec とこのプランを同じ変更で直す。

> 実装状況（2026-11-07）: Q1〜Q9は推奨案で確定し、P1を実装した。`live_export` Job、CLI、contracts、素材カード、manifest検証、統合テストまで完了している。P0.5bの実環境スパイク（実TTS参照音声、Chrome/Producerでのカード書き出し）はP6の受け入れ前に確認する。

## 0. 位置づけ

P1 の成果は、**Kakeai からライブパッケージを書き出し、`apps/live` が読める状態**までとする。ステージ、プレイアウト、コメント取得、LLM、実 YouTube は P2 以降で、P1 では実装しない。ただし P2 以降が依存する `StageLease` / `StageState` / `StageEvent` / `CommentEvent` / `CommentCandidate` / `CommentAnalysis` / `DirectorOutput` / `LiveRuntimeConfig` / `RunLogEvent` のスキーマは P1 で固定する。

P1 の完了条件は次のとおり。

- サンプル Work / ScriptVersion / Show Profile から `live_export` Job を作り、パッケージを書き出せる。
- `manifest.json` が列挙する全ファイルの SHA-256・byteSize・mediaType・種別・尺・寸法・無音フラグ・フォント診断・声のスナップショットを検証できる。
- `show.json` の `PreparedCue` が `lineId` から解決され、`sourceLineId` を持つ。ライブ専用キューは `origin: "live"` を持つ。
- 素材カードが静止 PNG / スクリプトなし静的 HTML / 短い無音 MP4 のいずれかで出力される。
- 参照音声がパッケージに含まれ、各 Voice Profile の短いテスト合成が通る。
- 書き出しが Kakeai の DB を変更しない（`live_export` Job とその状態を除く）。
- `npm run typecheck` と `npm test` が通る。

## 1. 前提とブロッカー

### P0.5b スパイク（P1 の前に完了させる）

P1 の実装に入る前に、次の 4 点を小さな使い捨てコードで確認する。結果は P1 の設計に反映し、失敗した場合は該当機能を退避する。

| スパイク | 確認すること | 失敗時の退避 |
| --- | --- | --- |
| TTS 参照音声 | `TtsSynthesisRequest.refAudioPath` にパッケージ内の参照音声を渡し、短い合成が通る。出力 mediaType と尺を確認する。 | 参照音声を使う Voice Profile は書き出し時に失敗させる。代替の声を案内する。 |
| 素材カード | 単一 Scene から PNG / スクリプトなし HTML / 無音 MP4 を作り、`img` / `script` なし iframe / `video` で表示できる。 | 動画カードを静止画 MP4 に退避する。HTML が難しい場合は PNG だけに絞る。 |
| manifest 検証 | SHA-256・mediaType・無音フラグ・フォント診断を小さな手作りパッケージで検証できる。 | 検証項目を P2 に回さず、P1 のテストで最低限のハッシュとパスだけ検証する。 |
| `streamList` | Node/REST または gRPC から実用的に使えるか。 | v1 は `list` ポーリングを継続する。P1 には影響しない。 |

`streamList` は P4 のスパイクであり、P1 のブロッカーではない。P1 では着手しない。

### 既存資産の再利用

- TTS アダプタは P1 では `apps/api/src/tts` の実装をそのまま使う。`packages/tts` への切り出しは P3 で行う。
- Theme 解決は `ThemeResolver`、フォントは `FontCatalogService`、素材は `resolveAssetContent`、既存 Audio Take は `NarrationSegment.selectedAudioTakeId` を使う。
- 素材カードのコンパイルは `packages/video` の既存テンプレートと `compileDocument` を再利用し、ライブ専用の巨大なレンダラーを新設しない。
- `live_export` は既存の `Job` テーブルに載せる。Prisma のマイグレーションは不要（`kind` は文字列、`resultJson` / `progressPercent` は既存）。

## 2. 設計方針

1. **台本の正本は ScriptVersion のまま**。通常キューは `lineId` で `NarrationSegment` を参照し、字幕・読み上げ・話者・音声を書き出し時に解決する。Show Profile に同じ内容を二重に書かせない。
2. **Job スナップショットに全入力を固定する**。ScriptVersion の `contentJson`、Theme 定義、Asset メタデータ、Face Set 改訂、Voice Profile、Show Profile、fixture を `inputSnapshotJson` に入れる。Worker は実行時に可変な DB を読まない。
3. **API は入力を早く検証する**。`POST /api/v1/live-exports` でスキーマ、参照、テーマ、フォント、Asset、出力先を検証し、問題があれば 422 / 409 を返す。TTS のテスト合成とファイル書き出しだけを Worker に回す。
4. **ファイル名は ID から直接作らない**。ID は `idSchema`（任意の非空文字列）であり、パスに使うと `..` や `/` が入り得る。パッケージ内のファイル名は連番・SHA-256・固定名で生成し、`show.json` / `characters.json` の中で対応を表現する。
5. **manifest は manifest 自身を含めない**。自己ハッシュは不可能なので、`files` は `manifest.json` 以外の全ファイルを列挙する。Loader は「列挙された全ファイルの検証」と「manifest 以外の未列挙ファイルの拒否」を行う。
6. **書き出しは原子的に確定する**。出力先の兄弟ディレクトリに一時ディレクトリを作り、完了後に rename する。途中失敗・キャンセルで既存パッケージを壊さない。
7. **失敗しても台本を止めない**はライブ実行時の原則。書き出し時は逆に、準備済み音声・参照音声・素材カードの失敗を ジョブ失敗として返し、壊れたパッケージを渡さない。

## 3. 追加・変更するファイル

### `packages/contracts`

```text
src/live/paths.ts        packageRelativePathSchema、mediaType、file kind
src/live/profile.ts      LiveShowProfile、セグメント、scriptCues、liveCues、materials
src/live/show.ts         LivePackageShow、PreparedCue、LiveCue、MaterialCard
src/live/characters.ts   LiveCharacterSheet、声、Face Set
src/live/manifest.ts     LivePackageManifest
src/live/stage.ts        StageLease、StageState、StageEvent
src/live/comment.ts      CommentEvent、CommentCandidate、CommentAnalysis、fixture
src/live/director.ts     DirectorOutput
src/live/runtime.ts      LiveRuntimeConfig
src/live/run-log.ts      RunLogEvent
src/live/index.ts        barrel
```

- `src/index.ts` から `./live` を re-export する。
- `src/live/*.test.ts` でスキーマ検証と未知バージョン拒否をテストする。
- `src/dto.ts` の `jobKindSchema` に `live_export` を追加し、Job DTO に `liveExportResult` を追加する。
- `src/job.ts` に `liveExportJobSnapshotSchema` と `LIVE_EXPORT_SNAPSHOT_SCHEMA_VERSION = 1` を追加する。既存の `SNAPSHOT_SCHEMA_VERSION = 3` は render / asset_ingest / tts 用に残す。共通定数を 4 に上げると、キューに残った旧 Job のスナップショットが読めなくなるため上げない。

### `packages/video`

```text
src/material-card/compile-card.ts   単一 Scene のカード HTML を生成
src/material-card/strip-scripts.ts  静的 HTML 用の script 除去
src/index.ts                        公開 API を追加
```

`compileMaterialCardRaw`（PNG/MP4 用）と `compileStaticMaterialCard`（HTML 用）は次の入力を受ける。

```ts
{
  document: ContentDocument;
  sceneId: string;
  theme: VisualThemeDefinition;
  durationMs: number;
  assetResolver: AssetResolver;
}
```

出力は `{ html, assetIds, compositionVersionIds, durationMs }`。内部では対象 Scene だけを持つ一時的な ContentDocument を作り、`compileDocument` に渡す。Scene は `timing: { mode: "fixed", durationMs }`、`lines: []`、`standingStates: []`、`audioCues: []` に正規化する。`range.kind !== "scene"` の VisualCue、nested Composition、動画 Asset、動画ゲートは明示的に拒否する。

### `apps/api`

```text
src/services/live-exports.ts        POST 用の検証・スナップショット作成
src/live/version.ts                 LIVE_EXPORTER_VERSION
src/live/profile-validation.ts      Show Profile の参照解決とエラー
src/live/prepare-cues.ts            lineId 解決、PreparedCue 生成
src/live/prepare-characters.ts      characters.json、Face Set、声
src/live/prepare-audio.ts           Audio Take のコピー、TTS、テスト合成
src/live/prepare-materials.ts       PNG / HTML / MP4 カード
src/live/theme-css.ts               theme.css とフォント診断
src/live/manifest.ts                manifest 生成
src/live/package-writer.ts          安全なファイル名、ハッシュ、原子的確定
src/live/verify-package.ts          manifest の検証（テストと Worker の最終確認）
src/live/errors.ts                  LiveExportError
src/worker/live-export.ts           processLiveExportJob
src/http/routes/live-exports.ts     POST /api/v1/live-exports
```

- `src/server.ts` でルーターを mount する。
- `src/worker/index.ts` の `claimNextJob` の kind 配列、dispatch、`markFailed` の error code 対応を追加する。
- `src/services/jobs.ts` の `cancelJob` を `live_export` に拡張する（実行中キャンセルは Q7 の判断）。
- `src/dto/mappers.ts` の `toJob` に `liveExportResult` を追加する。

### `apps/cli` / ルート

```text
apps/cli/src/live-export.ts        API クライアントと引数解析
apps/cli/src/live-export.test.ts   引数・ポーリング・失敗表示
apps/cli/bin/kakeai-live-export.js bin
apps/cli/package.json              bin と live:export script
package.json                       npm run live:export
```

### ドキュメント

```text
docs/live/p1-plan.md               この文書
docs/live/spec.md                  契約の確定分を反映
docs/live/todo.md                  P1 の項目をこのプランへリンク
docs/live/examples/                10分版・30分版の Show Profile と fixture
docs/mvp/spec.md                   live_export Job の追加
docs/mvp/api-contract.md           POST /live-exports と Job DTO
AGENTS.md                          npm run live:export
user-guide/docs/live/export.md     書き出しコマンドの最小ガイド
user-guide/sidebars.ts             ライブ配信カテゴリ
```

## 4. 契約

### 4.1 パッケージ相対パスと mediaType

```ts
export const livePackageRelativePathSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.startsWith("\\") &&
      !/^[a-zA-Z]:[\\/]/.test(value) &&
      !value.split(/[\\/]/).includes("..") &&
      !value.includes("\0"),
    { message: "パッケージ内の相対パスを指定してください" },
  );

export const liveMediaTypeSchema = z.enum([
  "text/css",
  "application/json",
  "text/html",
  "image/png",
  "image/jpeg",
  "image/webp",
  "video/mp4",
  "audio/wav",
  "audio/mpeg",
]);
```

- パス区切りは `/` に統一する。`\` は使わない。
- すべてのファイル参照はパッケージルートからの相対パスとする。
- `.html` カード内の Asset URL だけは、カードファイルからの相対パス（`../media/...`）にする。
- 許可しない mediaType の Asset は書き出しを失敗させる。SVG・WebM・OGG は v1 では許可しない。

### 4.2 `LiveShowProfile`（入力）

```ts
{
  schemaVersion: 1,
  show: {
    title: string,
    locale: "ja-JP",              // v1 は ja-JP のみ
    targetDurationMs: number,
    stageTemplate: string,
    theme: "theme.css",
    characters: { left: characterId, right: characterId | null },
    speakerSides?: Record<speakerId, "left" | "right">,
    startAt: string | null,
  },
  commentSource: { kind: "youtube" | "fixture" },
  segments: LiveSegment[],
  scriptCues: { id, lineId, expressionId? }[],
  liveCues: { id, speaker, caption, speech, expression, audioAssetId? }[],
  materials: { id, sceneId, focus, format?: "png" | "html" | "mp4", durationMs?: number }[],
  commentPolicy: {
    mode: "corner",
    freshnessMin: number,
    maxCommentsPerCorner: number,
    maxHumanPinsPerCorner: number,
    maxExtraSlots: number,
    allowImmediateInterrupt: false,
    skipWhenEmpty: boolean,
  },
  safety: {
    blockedTopics: string[],
    persona: string,
    maxResponseChars: number,
    maxResponseCues: number,
    fallbackCueId: string,
  },
  playout: {
    minBufferMs: number,
    maxThinkingMs: number,
    closingReserveMs: number,
    noApprovalDelay: true,
  },
  test: { fixture: string } | undefined,
}
```

入力プロファイルの `liveCues` の要素を `LiveCueInput`、実行時のキューを `LiveCue` と呼び、型を分ける。

`LiveSegment` は kind で判別する。

```ts
{ id, kind: "opening" | "script" | "closing", label, targetDurationMs, material?, cues: string[] }
{ id, kind: "comment", label, targetDurationMs, commentPolicy? }
```

追加する制約:

- `show.locale` は v1 では `ja-JP` のみ。`show.theme` はパッケージ内の固定ファイル名 `"theme.css"` で、実際の Theme は `ContentDocument.visualTheme` から解決する。
- `segments` は先頭が `opening`、末尾が `closing`、その間に `script` を 1 つ以上持つ。`comment` は任意。
- `segments[].cues` は `scriptCues` または `liveCues` の ID を参照する。重複 ID は拒否する。
- `safety.fallbackCueId` は `scriptCues` または `liveCues` に実在する。
- `scriptCues[].lineId` は ScriptVersion 内で一意に存在する。`expressionId` は `NarrationSegment.expressionId` を上書きする。
- `liveCues[].speaker` は `left` または `right`。`audioAssetId` は Kakeai の Audio Asset を参照し、パッケージ内パスは入力に書かせない。
- `materials[].format` の既定は `png`、`durationMs` の既定は `4000`。`mp4` のときだけ `durationMs` を 3000〜5000 に制限する。
- `test.fixture` はプロファイルファイルからの相対パス。CLI が読み、API には fixture の配列を渡す。出力では `fixtures/comments.json` に固定する。`commentSource.kind === "fixture"` のときは `test.fixture` と fixture 配列を必須にする。
- `commentPolicy.mode` は `corner` のみ、`allowImmediateInterrupt` は `false` のみ、`playout.noApprovalDelay` は `true` のみを v1 の literal とする。

### 4.3 `LivePackageShow`（出力 `show.json`）

```ts
{
  schemaVersion: 1,
  show: {
    title, locale, targetDurationMs, stageTemplate, theme,
    characters: { left, right },
    startAt,
  },
  commentSource: { kind },
  segments: ResolvedSegment[],
  cues: PreparedCue[],
  materials: MaterialCard[],
  speakers: LiveSpeaker[],
  commentPolicy,
  safety,
  playout,
  test: { fixture: "fixtures/comments.json" } | undefined,
}
```

`LivePackageShow` の `show.characters` は左右のキャラクター ID だけを持ち、外観・顔レイヤー・声の詳細は `characters.json` に置く。`speakers` は話者 ID と左右・キャラクターの対応を持つ。

`PreparedCue`:

```ts
{
  id: string,
  origin: "script" | "live",
  sourceLineId?: string,       // origin: "script" では必須
  speaker: "left" | "right",
  caption: string,
  speech: string,
  expression: string,
  audio: livePackageRelativePathSchema,
  durationMs: number,          // 音声尺。P3 の先読み・ウォッチドッグに使う
}
```

- `origin: "script"` は `NarrationSegment` の `captionText` / `speechText` / `speakerId` / `selectedAudioTakeId` から解決する。
- `expression` の優先順位は、Show Profile の `scriptCues[].expressionId` > `NarrationSegment.expressionId` > `"normal"`。
- `origin: "live"` は入力の `caption` / `speech` / `speaker` / `expression` をそのまま使う。`audioAssetId` があればコピーし、なければ TTS する。
- `speaker` は `show.speakerSides` を優先し、なければ `NarrationSegment.speakerId` の `characterId` を `show.characters` に照合する。どちらでも解決できなければ書き出しを失敗させる。
- v1 は左右それぞれ 1 Speaker までとする。同じ side に複数の Speaker が割り当てられた場合は書き出しを失敗させる。
- `PreparedCue` は必ず音声を持つ。TTS に失敗したキューがある場合、パッケージは成功にしない。

`MaterialCard`:

```ts
{
  id: string,
  kind: "image" | "video" | "html",
  file: livePackageRelativePathSchema,
  hasAudio: false,
  focus: boolean,
  width: number,
  height: number,
  durationMs?: number,
}
```

`LiveSpeaker`:

```ts
{
  id: string,
  name: string,
  side: "left" | "right",
  characterId: string | null,
  voice: {
    adapterId: "voicevox" | "aivisspeech" | "openai-compatible",
    voiceId: string,
    speedScale: number,
    settings: Record<string, unknown>,  // refAudioAssetId は除去する
    refAudio?: livePackageRelativePathSchema,
  },
}
```

`LiveCue`（実行時のキュー、P3 以降）:

```ts
{
  id: string,
  origin: "script" | "live",
  sourceLineId?: string,
  speaker: "left" | "right",
  caption: string,
  speech: string,
  expression: string,
  audio: string | null,        // preparing / draft では null を許す
  durationMs: number | null,
  source: "prepared" | "generated" | "manual" | "fallback",
  status: "draft" | "preparing" | "ready" | "playing" | "done" | "skipped" | "failed",
  commentId: string | null,
}
```

### 4.4 `characters.json`

```ts
{
  schemaVersion: 1,
  characters: [{
    id: string,
    side: "left" | "right",
    name: string,
    appearances: [{
      id: string,
      expression: string,
      image: livePackageRelativePathSchema,
      faceSetId: string | null,
      faceSetVersion: number | null,
      standing: StandingLayout | undefined,
    }],
    voice: LiveSpeaker["voice"],
  }],
  faceSets: [{
    id: string,
    version: number,
    layers: [{
      id: string,
      part: "brow" | "eye" | "mouth" | "foreground",
      file: livePackageRelativePathSchema,
      blinkFile?: livePackageRelativePathSchema,
      speakingFile?: livePackageRelativePathSchema,
    }],
    expressions: [{
      id: string,
      name: string,
      browLayerId: string | null,
      eyeLayerId: string | null,
      mouthLayerId: string | null,
    }],
  }],
}
```

- キャラクターは左右で使う 2 体だけを出力する。使わないキャラクターは含めない。
- Appearance はそのキャラクターの全外観を出力し、P3 が `expression` で選ぶ。`expression: "normal"` が無い場合は書き出しを失敗させる。
- Face Set は Appearance が参照する `(faceSetId, faceSetVersion)` の改訂だけを含める。`normal` Expression を必須とする。
- Asset ファイルは `media/assets/<sha256>.<ext>` に集約し、同じ Asset を重複してコピーしない。
- 声の `settings` から `refAudioAssetId` を除き、`refAudio` に置き換える。接続設定（`baseUrl`・API キー）は入れない。

### 4.5 `manifest.json`

```ts
{
  packageSchemaVersion: 1,
  exporterVersion: string,
  packageId: string,                 // "livepkg-" + 24 hex
  createdAt: string,
  source: {
    workId, languageEditionId, scriptVersionId,
    theme: { id, version },
    profileSha256: string,
  },
  files: [{
    path: livePackageRelativePathSchema,
    sha256: string,
    byteSize: number,
    mediaType: liveMediaTypeSchema,
    kind: "theme" | "show" | "characters" | "asset" | "material"
        | "voice-ref" | "prepared-audio" | "fixture",
    durationMs: number | null,
    width: number | null,
    height: number | null,
    hasAudio: boolean,
  }],
  fonts: LiveManifestFont[],        // { role, family, found, fallback, required }
  voices: [{
    speakerId: string,
    characterId: string | null,
    adapterId: string,
    voiceId: string,
    refAudio: livePackageRelativePathSchema | null,
    refAudioSha256: string | null,
    testSynthesis: "ok",
  }],
}
```

- `files` は `manifest.json` を除く全ファイルを path の昇順で持つ。
- `LiveManifestFont` は `{ role, family, found, fallback, required }`。POST 時に `FontCatalogService.resolveThemeFonts` から作り、スナップショットに固定する。Worker はフォントカタログを再度呼ばない。
- `packageId` は `source`・`profileSha256`・`exporterVersion` から決定的に作る。同じ入力の再書き出しで同じ ID になる。
- `createdAt` は書き出し時刻。`packageId` には含めない。
- `fonts` は `FontCatalogService.resolveThemeFonts` の `roles` から作る。`required` は v1 では常に `false`（P2 で不足は警告）。
- `voices` は実際に使う Voice Profile だけを含む。`testSynthesis: "ok"` は書き出し時のテスト合成の成功を表す。
- `files` の `durationMs` は音声・動画のみ、`width` / `height` は画像・動画のみ。それ以外は `null`。
- `hasAudio` は音声ファイルだけ `true`。動画カードは `false` を必須とし、FFprobe で音声ストリームが無いことを確認する。

### 4.6 Stage / Comment / Director / Runtime / Log

P1 ではスキーマだけを定義し、実装は P2 以降に回す。フィールドの正は spec の該当節とする。

- `StageLease`: `leaseId`, `runId`, `sessionId`, `role: "program" | "preview"`, `expiresAt`。
- `StageState`: `phase`, `segment`, `characters`, `caption`, `material`, `comment`, `status`, `playback`, `clock`。`playback.audioUrl` はパッケージ相対パス。`comment.text` はサーバが安全要約から作った表示用テキストで、生コメントを入れない。
- `StageEvent`: `kind: "stage_ready" | "audio_ended" | "audio_error" | "stage_heartbeat"`, `runId`, `sessionId`, `cueId`, `attempt`, `sequence`, `positionMs?`, `error?`。
- `CommentEvent`: `id`, `authorName`, `text`, `publishedAt`, `receivedAt`, `kind: "normal" | "superchat" | "member"`。
- `CommentCandidate`: `commentId`, `score`, `safety: "ok" | "review" | "block"`, `relevance: "high" | "medium" | "low"`, `isQuestion`, `reason`, `suggestedAngle`, `safeSummary`, `safeQuestion`, `safeQuote`, `piiRedacted`, `urlsRemoved`。
- `CommentAnalysis`: `{ comments: CommentCandidate[] }`。
- `DirectorOutput`: `{ cues: [{ speaker: "left" | "right" | "none", caption, speech, expression }], skip: boolean }`。
- `LiveRuntimeConfig`: `{ llm: { mode, baseUrl, model, apiKey? }, tts: { adapters: Record<adapterId, { baseUrl, apiKey? }> }, port, dataDir }`。
- `RunLogEvent`: `{ schemaVersion, runId, sequence, at, type, cueId?, commentId?, data }`。`type` は `phase_changed` / `pin_added` / `pin_removed` / `comment_selected` / `cue_generated` / `cue_edited` / `cue_deleted` / `cue_skipped` / `stopped` / `resumed` / `safe_mode` / `error`。

### 4.7 Job / API

`jobKindSchema` に `live_export` を追加する。

`POST /api/v1/live-exports`:

```json
{
  "workId": "work_...",
  "scriptVersionId": "sv_...",
  "profile": { "schemaVersion": 1, "...": "..." },
  "fixture": [{ "atMs": 0, "author": "A", "text": "こんにちは", "kind": "normal" }],
  "outDir": "/absolute/path/to/package"
}
```

- `fixture` は任意。`profile.test.fixture` がある場合は必須。
- `outDir` は絶対パス。親ディレクトリが存在し、自身は存在しないこと。シンボリックリンクは拒否する。
- 成功時は 202 と Job DTO。入力不正は 422 `VALIDATION_ERROR`、出力先が使用中は 409 `LIVE_EXPORT_OUTPUT_UNAVAILABLE`。
- 実行中キャンセルは Q7 の判断に従う。queued のキャンセルは既存の `cancelJob` で行う。

`liveExportJobSnapshotSchema`:

```ts
{
  snapshotSchemaVersion: 1,
  kind: "live_export",
  workId, languageEditionId, scriptVersionId, versionNumber, locale,
  content: ContentDocument,
  profile: LiveShowProfile,
  profileSha256: string,
  fixture: LiveFixtureComment[] | undefined,
  outDir: string,
  exporterVersion: string,
  theme: VisualThemeDefinition,
  skin: VisualSkinRef | undefined,
  assets: SnapshotAssetRef[],
  faceSets: SnapshotFaceSet[],
  voiceProfiles: SnapshotVoiceProfile[],
  fonts: LiveManifestFont[],       // POST 時に解決した manifest.fonts の元
  fontDiagnostics: { missingFonts: string[], diagnostics: string[] },
}
```

`SnapshotVoiceProfile` は `{ id, name, adapterId, voiceId, locale, settings, refAudioAssetId? }`。`refAudioAssetId` は settings 内の OpenAI 互換の参照音声を解決するために使う。

`liveExportResultSchema`（Job DTO の `liveExportResult`）:

```ts
{
  packagePath: string | null,
  packageId: string | null,
  manifestSha256: string | null,
  fileCount: number | null,
  preparedCueCount: number | null,
  warnings: string[],
  failures: [{ stage: string, id: string | null, message: string }],
}
```

- `succeeded` の `live_export` は `liveExportResult` を必須とし、`packagePath` / `packageId` / `manifestSha256` を非 null にする。
- `failed` のときも `liveExportResult` を持てる。`failures` に失敗したキュー・Voice Profile・素材 ID を入れる。既存の `Job.resultJson` に保存し、DB マイグレーションは行わない。
- `packagePath` は絶対ローカルパスを返す唯一の例外とする。API はループバック限定で、利用者は CLI であることを `docs/mvp/api-contract.md` に明記する。

追加する Job error code:

- `LIVE_EXPORT_INPUT_INVALID`
- `LIVE_EXPORT_TTS_FAILED`
- `LIVE_EXPORT_MATERIAL_FAILED`
- `LIVE_EXPORT_FAILED`
- `LIVE_EXPORT_OUTPUT_UNAVAILABLE`

## 5. 書き出しパイプライン

### 5.1 `POST /live-exports`（同期検証）

1. `liveExportRequestSchema` を parse する。
2. ScriptVersion を取得し、`workId` / `languageEditionId` との整合を確認する。
3. `contentJson` を `deserializeContent` し、`ContentDocument` を parse する。
4. Show Profile の参照を解決する。
   - `scriptCues[].lineId` の一意存在。
   - Speaker → 左右のマッピング。
   - キャラクター、Appearance、Face Set 改訂。
   - Voice Profile、参照音声 Asset。
   - Asset の ready / Rendition / 尺。
   - 素材 Scene の存在と制約（nested Composition・動画・セリフ・音声・standing の拒否）。
   - fallback cue、fixture の存在。
5. Theme を解決し、`FontCatalogService.resolveThemeFonts(..., { verify: true, locale })` を呼ぶ。テストでは `FakeFontCatalogAdapter` を注入する。
6. `outDir` を検証する。絶対パス、NUL なし、存在しないこと。
7. `profileSha256` を canonical JSON から計算する。
8. すべてを `liveExportJobSnapshotSchema` に固定し、`Job` を `queued` で作る。
9. Job DTO を返す。

POST では TTS を呼ばない。TTS のテスト合成と準備音声の生成は Worker で行う。これにより、POST の応答を TTS エンジンの起動待ちで遅らせない。

### 5.2 Worker の流れ

`processLiveExportJob(prisma, config, job, deps)`:

1. スナップショットを parse し、`outDir` を再検証する。
2. `outDir` の兄弟に `.<basename>.live-export-<jobId>.tmp` を作る。前回の同じ Job の一時ディレクトリが残っていれば削除する。
3. `theme.css` と `fonts` を作る。
4. `characters.json` と Asset コピーを作る。
5. PreparedCue を解決する（字幕・読み上げ・話者・表情・音声尺）。
6. 音声を準備する（既存 Take のコピー、TTS、テスト合成、参照音声）。
7. 素材カードを書き出す（PNG / HTML / MP4）。
8. `fixtures/comments.json` を書く（fixture がある場合）。
9. `show.json` を書く。
10. `manifest.json` を書く（全ファイルのハッシュを記録）。
11. `verify-package` でハッシュ・サイズ・mediaType・無音・パスを再検証する。
12. 一時ディレクトリを `outDir` に rename する。
13. Job を `succeeded` にし、`liveExportResult` を保存する。

各段階で `progressPercent` を更新する（例: 10, 20, 30, 45, 65, 80, 90, 95, 100）。失敗時は一時ディレクトリを削除し、`liveExportResult.failures` と `errorMessage` を残す。

### 5.3 安全なファイル名

| 種類 | 出力先 |
| --- | --- |
| Theme | `theme.css` |
| Show | `show.json` |
| Characters | `characters.json` |
| Manifest | `manifest.json` |
| Asset（キャラクター画像・顔レイヤー・素材画像） | `media/assets/<sha256>.<ext>` |
| 参照音声 | `media/voice/ref-<index>.<ext>` |
| 準備済み音声 | `audio/prepared/cue-<index>.<ext>` |
| 素材カード | `materials/card-<index>.<ext>` |
| fixture | `fixtures/comments.json` |

- 連番は `show.json` / `characters.json` の配列順で決める。同じ入力なら同じ順序になる。
- Asset は SHA-256 で内容同定し、同じバイト列を 1 回だけコピーする。
- 元のファイル名・絶対パス・シンボリックリンクはパッケージに残さない。
- 書き出し後に `lstat` でシンボリックリンクが無いことを確認する。

### 5.4 PreparedCue の解決

- `scriptCues` は `content.scenes[].lines[]` から `lineId` を探す。見つからない、複数ある、`speakerId` が null、`captionText` / `speechText` が空の場合は失敗。
- 音声は `selectedAudioTakeId` → `audioTakes[]` → Asset / Rendition の順で解決する。Take の `durationMs` と Asset / Rendition の尺が一致しない場合は失敗。
- Audio Take が無い場合は、Speaker の Voice Profile で TTS する。`speechText` は空にできない。
- `liveCues` は `audioAssetId` があればその Asset をコピーし、なければ TTS する。
- TTS の出力は WAV または MP3 を許可し、`probeMedia` で尺を取得する。WAV / MP3 以外は WAV へ変換する。
- 音声の尺は `PreparedCue.durationMs` と manifest に記録する。P3 は実行時に FFprobe を呼ばない。
- `audio/prepared/` のファイルはすべてステージから `<audio>` で再生できる形式にする。

### 5.5 声のスナップショットとテスト合成

- 使用する Voice Profile を話者ごとに一意化する。同じプロファイルを複数話者が使う場合は 1 回だけテスト合成する。
- OpenAI 互換で `refAudioAssetId` がある場合、Asset を `media/voice/` にコピーし、manifest に SHA-256 を記録する。実行時はパッケージ相対パスを絶対パスへ解決して `refAudioPath` に渡す。
- 各 Voice Profile で短いテキスト（例: `"テスト"`）を 1 回合成し、尺 > 0 を確認する。失敗したら Job を `LIVE_EXPORT_TTS_FAILED` で失敗させ、Voice Profile ID を `failures` に入れる。
- 本番の準備音声は、テスト合成の後にキュー単位で生成する。TTS の並列度は 2 程度に制限し、進捗を更新する。
- `baseUrl` は既存の `resolveVoiceBaseUrl` を使い、ループバック制約を維持する。接続設定はパッケージに入れない。

### 5.6 素材カード

- `materials[].sceneId` の Scene を 1 つ取り出す。
- 次の場合は失敗させる。
  - `lines` が 1 つ以上ある。
  - `standingStates` が 1 つ以上ある。
  - `audioCues` が Scene の範囲に重なる。
  - `range.kind !== "scene"` の VisualCue がある。
  - nested Composition がある。
  - 動画 Asset、または動画ゲートがある。
  - 未対応 mediaType の Asset がある。
- `compileMaterialCardRaw`（PNG/MP4）または `compileStaticMaterialCard`（HTML）で 1920x1080 の HTML を作る。`durationMs` は `materials[].durationMs`（既定 4000）。
- PNG:
  - AssetResolver は data URL を返す。`Rasterizer.renderPng` で 1920x1080 の PNG を作る。
  - PNG は `materials/card-<index>.png`。manifest は `image/png`、`hasAudio: false`。
- HTML:
  - AssetResolver はカードファイルからの相対 URL（`../media/assets/...`）を返す。
  - コンパイル結果から `<script>` をすべて除去する。`on*` 属性・`javascript:` URL が無いことを検証する。
  - `text/html`、`hasAudio: false`。
- MP4:
  - AssetResolver は一時プロジェクトのルート相対 URL（`media/assets/...`）を返す。
  - `@hyperframes/producer` で `durationMs` の MP4 を作る。音声トラックが無いことを FFprobe で確認する。
  - `video/mp4`、`hasAudio: false`、`durationMs` を記録する。
  - Producer が重すぎる場合は、PNG を `durationMs` 保持する静止画 MP4 に退避し、その旨を `warnings` に残す（Q3）。
- PNG の data URL と MP4 の一時プロジェクト URL は中間生成物であり、パッケージには残さない。パッケージに残る HTML は必ずカードファイルからの相対 URL を使う。
- PNG / MP4 カードは自己完結するため、入力に使った素材 Asset はパッケージへコピーしない。HTML カードだけ、HTML が参照する Asset を `media/assets/` にコピーする。キャラクター画像・顔レイヤーは形式にかかわらずコピーする。
- カードは中央スロットで縮小表示する前提だが、ファイル自体は 1920x1080 とする。
- P3 のステージは `iframe src` でパッケージ配信 URL を読み込む。`srcdoc` は相対 URL を解決できないため使わない。この制約を P2/P3 の実装メモに残す。

### 5.7 Theme とフォント

- `theme.css` は `:root { ... }` に `themeRootStyle(theme, locale)` の CSS 変数を出す。
- caption / title / label などの役割ごとの `font-family` を `resolveFontFamilyCss` で追加する。
- `fonts[]` は POST 時に `FontCatalogService.resolveThemeFonts` の `roles` から作り、スナップショットの `fonts` をそのまま manifest に書く。`found: false` は `usesFallback: true`。Worker はフォントカタログを再度呼ばない。
- v1 では `required: false`。P2 の Loader は不足を警告し、`required: true` のフォントだけ停止にする。
- フォントファイルはパッケージに含めない。同じ Mac のローカルフォントを使う。

### 5.8 manifest と検証

- 書き出し中に `PackageWriter` がファイルごとに `sha256` / `byteSize` / `mediaType` / `kind` / `durationMs` / `width` / `height` / `hasAudio` を記録する。コピーとハッシュを別々に読まない。
- `manifest.json` は最後に書き、`files` に自分自身を含めない。
- `verify-package` は次を検証する。
  - `manifest.json` 以外の全ファイルが `files` に存在し、ハッシュとサイズが一致する。
  - `files` に無いファイルが `manifest.json` 以外に存在しない。
  - すべてのパスが相対で、`..` を含まず、シンボリックリンクでない。
  - mediaType と拡張子が一致する。
  - 動画カードに音声ストリームが無い。
  - カードの `width` / `height` が 1920x1080。PNG / MP4 は実ファイルの寸法も一致し、HTML は宣言値だけを検証する。
  - `show.json` の `PreparedCue.audio` / `MaterialCard.file` / `speakers[].voice.refAudio` と、`characters.json` の画像・顔レイヤーが `files` に存在する。
- 検証に失敗したら `outDir` を確定しない。

### 5.9 原子的確定と後片付け

- 一時ディレクトリは `outDir` と同じ親に作る。`rename` が同一ファイルシステム内で完結するようにする。
- `outDir` は存在しないことを前提に、rename で原子的に確定する。
- 失敗時は一時ディレクトリを削除する。プロセスが落ちた場合は、起動時のメンテナンスで `.live-export-*.tmp` を掃除する。
- 出力先が別ボリュームの場合は rename できないため、P1 では「同じボリュームに出力する」ことをユーザーガイドに書く。クロスデバイスのコピーは P7 で扱う。

## 6. 実装フェーズ

依存関係は P1.0 → P1.1 → P1.2。P1.2 の骨格ができた後、P1.3（台本・声）と P1.4（素材・manifest）は並行できる。P1.5（CLI）は P1.2 の後に着手でき、P1.6（サンプル・文書）と P1.7（通し）は最後に置く。Q1〜Q9 が未回答のまま着手する場合は、このプランの推奨案で進める。

### P1.0 契約の確定とスパイク（S）

- P0.5b の TTS 参照音声・素材カード・manifest 検証を実施する。
- Q1〜Q9 の回答を反映し、`docs/live/spec.md` に契約の確定分を追記する。
- `docs/live/p1-plan.md` の未決事項を更新する。

完了条件: スパイク結果と契約の差分が spec に反映されている。

### P1.1 contracts（M）

- `packages/contracts/src/live/*` を追加する。
- `packages/contracts/src/index.ts`、`dto.ts`、`job.ts` を更新する。
- スキーマテストを追加する。
  - 正常系（spec の例）。
  - 未知の `schemaVersion` / `packageSchemaVersion` の拒否。
  - `origin: "script"` の `sourceLineId` 必須。
  - パス脱出（`../`、絶対パス、`\`）の拒否。
  - `LiveCue.speaker`、`DirectorOutput`、`StageEvent` の型検証。
  - `live_export` Job の snapshot / result の判別 union。

完了条件: `npm run typecheck` と contracts のテストが通る。

### P1.2 Job / API / Worker の骨格（M）

- `live_export` Job の作成、ルート、Worker dispatch、DTO、エラーコードを追加する。
- `POST /live-exports` の同期検証とスナップショット作成を実装する。
- `processLiveExportJob` は最初は `theme.css` / `show.json` / `manifest.json` の最小構成を書く。
- `liveExportResult` を Job DTO に追加する。

完了条件: 空に近い Show Profile から Job が作られ、Worker が最小パッケージを書き、Job が成功する。

### P1.3 台本・キャラクター・声（L）

- `lineId` 解決、`PreparedCue`、`speakerSides`、`characters.json` を実装する。
- Theme / フォント診断 / `theme.css` を実装する。
- Audio Take のコピー、TTS、参照音声、テスト合成を実装する。
- 既存 Audio Take の尺検証と、TTS 出力の probe を実装する。

完了条件: 10分版の `scriptCues` と `liveCues` が音声付きで `show.json` に出る。参照音声のテスト合成が通る。

### P1.4 素材カードと manifest（L）

- `packages/video` に素材カード用の compiler を追加する。
- PNG / HTML / MP4 の書き出しと無音検証を実装する。
- `PackageWriter`、`manifest`、`verify-package`、原子的確定を実装する。
- 失敗時の一時ディレクトリ削除と起動時掃除を実装する。

完了条件: 3 形式のカードが `materials/` に出て、manifest のハッシュ・mediaType・無音フラグが検証できる。HTML に script が無い。

### P1.5 CLI（S）

- `apps/cli/src/live-export.ts` を追加する。
- `--work` / `--script-version` / `--profile` / `--out` / `--timeout-ms` / `--interval-ms` を実装する。
- API の接続先は `KAKEAI_API_URL`（既定 `http://127.0.0.1:4317`）を使う。新しい永続設定は増やさない。
- `fixture` をプロファイルからの相対パスで読み、API に渡す。
- Job をポーリングし、成功時は stdout に `{ jobId, packagePath, packageId, warnings }`、失敗時は stderr にエラーと `failures` を出す。
- `npm run live:export -- ...` をルートに追加する。

完了条件: サンプルプロファイルから CLI でパッケージを書き出せる。API 未起動・Job 失敗・タイムアウトが明確に表示される。

### P1.6 サンプルとドキュメント（S）

- `docs/live/examples/show-10m.json`、`show-30m.json`、`comments-10m.json`、`comments-30m.json` を追加する。
- `docs/live/examples/README.md` に、デモ Work のキャラクター・シーン・行 ID の作り方を書く。
- `docs/mvp/spec.md` と `docs/mvp/api-contract.md` を更新する。
- `AGENTS.md` に `npm run live:export` を追加する。
- `user-guide/docs/live/export.md` とサイドバーを追加する。
- `README.md` は概要のまま、リンクだけ確認する。

完了条件: ドキュメントのコマンド例と実際の CLI が一致する。

### P1.7 通しテストと仕上げ（M）

- 10分版のサンプルで、Job 作成 → Worker → パッケージ検証 → CLI 表示まで通す。
- 30分版のプロファイルでも、TTS のキュー数・尺・進捗が破綻しないことを確認する。
- `npm run typecheck`、`npm test`、`npm run check:file-size` を通す。
- 新規ファイルを 600 行以下に保つ。超えそうならモジュールを分割する。

完了条件: P1 の受け入れ条件を満たし、既知の制約がプランとユーザーガイドに残っている。

## 7. テスト計画

| 対象 | テスト |
| --- | --- |
| contracts | 正常系、未知 schemaVersion 拒否、`sourceLineId` 必須、パス脱出拒否、Job union |
| Show Profile 参照 | `lineId` 不在、重複、speaker 未マップ、fallback 不在、fixture 不在 |
| PreparedCue | caption / speech / speaker / expression / audio / durationMs の解決、`origin` と `sourceLineId` |
| Audio Take | 既存 Take のコピー、尺不一致の拒否、Take なしの TTS、TTS 失敗 |
| 参照音声 | `media/voice/` へのコピー、manifest のハッシュ、Voice Profile ごとのテスト合成 1 回 |
| 素材カード | PNG 1920x1080、HTML に script なし、MP4 に音声ストリームなし、nested / 動画 / セリフ付き Scene の拒否 |
| manifest | 全ファイルのハッシュ・サイズ、未記載ファイルの拒否、絶対パス・シンボリックリンクの拒否、mediaType と拡張子 |
| フォント | 解決済みロール、fallback、missingFonts の記録、テストでは FakeFontCatalogAdapter |
| 出力先 | 空でないディレクトリの拒否、失敗時に部分パッケージが残らない、空ディレクトリの原子的確定 |
| DB 非変更 | 書き出し前後で ScriptVersion / Asset / ThemeRevision / VoiceProfile / FaceSet の件数と内容が変わらない。Job の追加だけを許す |
| API | 202 / 422 / 404 / 409、Job ポーリング、`liveExportResult` |
| CLI | 引数解析、fixture 読み込み、ポーリング、失敗表示、タイムアウト |
| キャンセル | queued のキャンセル。running は Q7 の判断に従う |
| パフォーマンス | 30分版のキューム数で TTS 並列度・進捗・メモリが破綻しない |

テストでは実 TTS を使わず、`startMockVoicevoxServer` または注入した Fake Adapter を使う。実フォントカタログは `FakeFontCatalogAdapter` に差し替える。MP4 と PNG の実レンダーは FFmpeg / Chrome が無い環境でスキップできるようにし、無い場合でも manifest とパスのテストは通す。

## 8. リスクと対策

| リスク | 対策 |
| --- | --- |
| 単一 Scene のコンパイルが既存テンプレートの一部で失敗する | `compileDocument` のエラーを `LIVE_EXPORT_MATERIAL_FAILED` に変換し、Scene ID とテンプレート ID を返す。代表テンプレートでテストする。 |
| MP4 カードのレンダーが遅い・不安定 | 3〜5 秒に制限し、失敗時は静止画 MP4 に退避して警告を残す（Q3）。 |
| TTS が 30 分版で長時間かかる | 並列度 2、進捗更新、実行中キャンセル（Q7）。Job は Worker を占有するため、他の Job が待つことをユーザーガイドに書く。 |
| ID に `/` や `..` が含まれる | ファイル名に ID を使わない。連番・SHA-256 固定名にする。 |
| manifest と実ファイルの不整合 | 書き込み時にハッシュを記録し、確定前に `verify-package` で再検証する。 |
| 参照音声のパスがパッケージ外を指す | 入力は `audioAssetId` のみ。出力は Asset をコピーしたパッケージ内パスだけ。`lstat` でシンボリックリンクを拒否する。 |
| フォント不足で見た目が変わる | manifest に `found` / `fallback` / `diagnostics` を残し、P2 で警告。v1 は停止しない。 |
| Worker が長時間占有される | 単一ユーザー前提で許容。進捗とキャンセルを用意し、P7 で Job 分離を検討する。 |
| `outDir` のクロスデバイス rename | P1 は同一ボリュームを要求し、ユーザーガイドに書く。P7 でコピー確定を追加する。 |

## 9. 確認したいこと（推奨案）

推奨案で進めてよい場合は「推奨案で」と回答してください。変更が必要な項目だけ指定してもらえれば、このプランと spec を更新します。

### Q1. Show Profile の API への渡し方

**推奨: CLI がプロファイルと fixture を読み、JSON 本文として API に送る。**

理由: API が利用者のファイルシステムを読む経路を減らし、Job スナップショットを自己完結にできる。`test.fixture` はプロファイルファイルからの相対パスとして CLI が解決し、API には fixture 配列を渡す。仕様の「パスまたは内容」は、v1 では「内容」に寄せる。

### Q2. manifest の自己ハッシュ

**推奨: `files` に `manifest.json` を含めない。**

理由: 自己ハッシュは不可能。Loader は「`manifest.json` 以外の全ファイルが `files` に一致」かつ「`files` に無いファイルが `manifest.json` 以外に無い」ことを検証する。この規則を spec に明記する。

### Q3. 素材カードの形式指定と MP4 の作り方

**推奨: `materials[].format`（`png` / `html` / `mp4`、既定 `png`）と `durationMs`（既定 4000）を追加する。MP4 は単一 Scene の HTML を `@hyperframes/producer` でレンダーし、重すぎる場合だけ静止画 MP4 に退避する。**

理由: 既存のコンパイラと Producer を再利用でき、カード内の短い動きも表現できる。退避した場合は manifest の `warnings` に残し、P7 で改善する。

### Q4. `liveCues` の音声指定

**推奨: 入力は `audioAssetId`、出力は `audio`（パッケージ相対パス）にする。**

理由: 入力プロファイルにパッケージ内パスや絶対パスを書かせない。`audioAssetId` が無ければ TTS する。仕様の `audio?` は出力側の表現として残す。

### Q5. Speaker と左右のマッピング

**推奨: `show.speakerSides?: Record<speakerId, "left" | "right">` を追加する。未指定なら `speaker.characterId` を `show.characters` に照合する。**

理由: `characterId: null` のナレーターを許しつつ、左右のキャラクターに声を割り当てられる。どちらでも解決できない Speaker は書き出し失敗にする。

### Q6. `PreparedCue.durationMs`

**推奨: 必須で追加する。**

理由: P3 の先読み、`minBufferMs`、ウォッチドッグ、再接続時の再生位置復元に音声尺が必要。実行時に FFprobe を呼ばずに済む。manifest にも同じ値を記録する。

### Q7. 実行中 `live_export` のキャンセル

**推奨: queued に加えて running も協調キャンセルできるようにする。**

理由: 30 分版の TTS は数分かかり、出力先を間違えたときに待てない。Worker はキュー境界と TTS 完了後にキャンセル状態を確認し、現在の 1 件が終わってから停止する。`cancelJob` の running キャンセル対象を `render` から `render` + `live_export` に広げる。

### Q8. サンプル Work の提供方法

**推奨: P1 では `docs/live/examples/` に 10 分版・30 分版の Show Profile と fixture を置き、デモ Work の作り方を README に書く。DB seed は追加しない。**

理由: seed は DB スキーマと UI に依存し、P1 の境界を広げる。自動テストはプログラムで組んだ fixture を使い、手動の受け入れは README の手順で Kakeai 上に Work を作る。P2 で必要なら seed コマンドを追加する。

### Q9. Job DTO の `liveExportResult`

**推奨: `ttsResult` と同じ形で `liveExportResult` を追加する。成功時は `packagePath` / `packageId` / `manifestSha256` / `fileCount` / `preparedCueCount` / `warnings`、失敗時は `failures` を持つ。**

理由: CLI と将来の UI が、どのキュー・Voice Profile・素材で失敗したかを表示できる。`packagePath` は API が絶対ローカルパスを返す唯一の例外とし、ループバック限定であることを api-contract に明記する。

## 10. P1 では決めないこと

- `streamList` の採用可否と gRPC 依存（P4）。
- YouTube OAuth の公開・検証、7 日失効の運用（P4 / P6）。
- コメント分析・ディレクターのプロンプト、ローカル LLM のモデル・量子化（P5）。
- ステージの正確な CSS、立ち位置、素材カードのスロット寸法（P2 / P3）。
- コメントカードの見た目とフォント（P4）。
- `packages/tts` への切り出し（P3）。
- ライブパッケージ書き出しの Web UI（P7 以降）。
- 素材集（フィラー）の自動選択（ロードマップ）。
- VOD 用のログ変換（ロードマップ）。

## 11. 完了の定義

P1 は次をすべて満たしたときに完了とする。

- `POST /api/v1/live-exports` から `live_export` Job を作れる。
- サンプル Work から 10 分版のパッケージを書き出せる。
- `show.json` の通常キューが `lineId` から解決され、`sourceLineId` を持つ。
- `liveCues` が `origin: "live"` で出力される。
- 準備済み音声と参照音声が `audio/prepared/` と `media/voice/` にあり、manifest のハッシュが一致する。
- PNG / HTML / MP4 の素材カードが出力され、HTML に script が無く、MP4 に音声が無い。
- `manifest.json` の全ファイル・フォント・声が検証できる。
- 書き出しが DB を変更しない（`live_export` Job とその状態を除く）。
- `npm run typecheck`、`npm test`、`npm run check:file-size` が通る。
- `npm run live:export -- ...` が Job をポーリングし、成功時にパッケージパスと警告を表示する。
- `docs/mvp/spec.md`、`docs/mvp/api-contract.md`、`docs/live/spec.md`、`AGENTS.md`、ユーザーガイドが実装と一致する。
