# エージェントMP4制作 調査結果

> **実装状況（2026-10-24）**: 本調査で挙げた P1 / P2 の項目は、実装または
> ガイド路線で対応済み。
> en-US の初期台本は P1 で修正し、`job.list` の `kind` と `script.save` の
> 基準版ガード / source は P2 で追加した。`work.create` の冪等化は
> `requestId` を追加せず、`work.list` で確認するガイド路線としている。

## 調査の前提

- 対象は MCP / CLI の Agent Access とする。HTTP API の直接利用は
  [`skills/kakeai-production/SKILL.md`](../../skills/kakeai-production/SKILL.md) が
  禁じているため、到達可能性は操作カタログ
  （[`packages/contracts/src/agent.ts`](../../packages/contracts/src/agent.ts)）で判定した。
- 「MP4を出せる」の合格ラインは、Kakeai 内に `role: "render"` /
  `format: "mp4"` の Artifact が生成され、人間が UI から取得・確認できること。
  絵・音の最終品質判断、サムネイル、SRT、YouTube 投稿設定は人間が行う。
- この調査は読み取りのみで、コード変更はしていない。

## 結論

操作コア、契約、MCP/CLI、ソケット、TTS、レンダー、Job の部品は揃っている。
台本編集、検証、素材取り込み、キャラクターのコピー、一括TTS、レンダー投入、
Job 待機まで、設計された順序で呼べば動く。

一方で、**新規作品をゼロからナレーション付きで完走する経路は狭い**。
調査時点で MP4主線を止めていたのは編集APIではなく、次の3点だった。

1. **声の前提**: 新規作品は話者を持たず、TTS は
   `speaker.voiceProfileId` を必須とする。エージェントには Voice Profile を
   一覧・作成する操作も、既存話者へ声を割り当てる専用操作も無い
   （`script.save` の全体置換では技術的に設定できるが標準手順ではない）。
   声付きキャラクターをライブラリからコピーするのが標準経路で、
   ライブラリに該当が無いと人間の事前設定なしには TTS できない。
2. **en-US の初期台本**: `work.create` は Edition の locale だけを指定値にし、
   初期台本は常に ja-JP で作っていた。en-US 作品の最初の `script.edit` は
   locale 不一致で失敗していた。**P1 で修正済み**（現在は指定 locale で
   初期台本を作る）。
3. **一括TTSの順序制約**: `requestId` なしの `tts.createBulk` は確定できず、
   `createBulk` と `attachBulk` の間の台本保存は `SCRIPT_BASE_STALE` で
   全滅する。同じ `agentId` で確定する必要がある。

この3点のうち en-US は P1 で解消した。TTS Job の再発見は P2 の
`job.list { kind: "tts" }` で可能になり、`script.save` は P2 で基準版ガードと
`sourceScriptVersionId` を得た（`requestId` は未対応のまま）。声の前提は
設計上の制約として残る。視覚確認、サムネイル、字幕、YouTube 設定は
今回のスコープ外であり、MP4主線の blocker ではない。

## 1. 成立している部分

| 領域 | できること | 条件・補足 |
| --- | --- | --- |
| 作品・台本 | `work.create`（ja-JP / en-US）、`script.get`、`script.edit`、`script.validate`、`script.save`（任意の基準版ガード・同一 Edition の復元元） | `script.edit` は `baseScriptVersionId` と `requestId` で競合検出・冪等再送ができる |
| 素材 | `asset.list`（検索・ソート・ページング）、`asset.import`（ローカルパス）、内容ハッシュ重複排除、`asset.tag`、`job.wait` | アプリと同じマシンで読めるファイルであること |
| キャラクター | `character.list` / `character.get`、`character.addFromLibrary`、`line.setSpeaker`、`standing.set` | ライブラリに locale 一致の声を持つキャラクターがあること |
| TTS | `tts.create`、`tts.createBulk`、`tts.attachBulk`、`line.assignTake`、話速指定、`requestId` 冪等 | 利用者が設定済みの TTS Adapter と、話者に紐づく Voice Profile があること |
| レンダー・Job | `render.start`、`job.get` / `job.list` / `job.cancel`（queuedのみ）/ `job.wait`、`preview.frame` | ワーカーが動作していること。`preview.frame` はレンダー成果物が前提 |
| 契約・束縛 | `schema.get`、`schemaDigest` / `operationDigest`、MCP/CLI の同じ操作・同じエラーコード | 最初に `schema.get` を呼ぶ運用が前提 |
| 多言語 | `edition.create`、翻訳 ContentDocument の `script.save` | 声は引き継がれない。TTS には別途声の設定が必要 |

## 2. MP4主線を止めるもの

### 2.1 声の前提（最重要）

新規作品の初期 ContentDocument は `speakers: []` で作られる
（[`packages/contracts/src/content/defaults.ts`](../../packages/contracts/src/content/defaults.ts)）。
TTS は次の順で検証するため、話者と Voice Profile が無いと必ず止まる。

1. `NarrationSegment.speakerId` が `null` でないこと
2. `Speaker.voiceProfileId` が `null` でないこと
3. Voice Profile が DB に存在し、Adapter が対応していること
4. Voice ID が接続中エンジンの一覧に存在すること

（[`apps/api/src/services/tts-jobs.ts`](../../apps/api/src/services/tts-jobs.ts)）

エージェントの操作カタログには、Voice Profile の一覧・作成・更新・削除も、
既存 Speaker へ声を割り当てる専用操作も無い。標準の手段は
`character.addFromLibrary` で、声付きキャラクターを台本へコピーする
（`Speaker.voiceProfileId` は `Character.voices` の locale 一致から決まる）。
`script.save` で ContentDocument 全体を置換すれば `voiceProfileId` を
技術的に設定できるが、標準手順ではなく、運用上は人間の設定に委ねる。
**新規インストールでライブラリが空の場合、エージェントだけでは声を
用意できない**。

既存作品ですでに TTS 対象の話者が有効な `voiceProfileId` を持っている場合は、
ライブラリのキャラクターを追加しなくても TTS できる。MP4主線の前提は
「新規作品なら声付きキャラクター、既存作品なら有効な `voiceProfileId`」と
整理するのが正確である。

`docs/agent-new-work/todo.md` の P0 実測でも、停止の支配因は
「話者/声未設定」と「`requestId` なしの一括TTS開始」と記録されている。

代替として、外部で生成した音声ファイルを `asset.import` し、
`line.assignTake` で台本へ入れることはできる。ただしこれは Kakeai の TTS を
使わない経路であり、MP4主線の標準手順ではない。

### 2.2 `work.create` の locale シード不具合（P1で修正済み）

修正前は、`createWork` が `createInitialContentDocument()` を常に ja-JP で作り、
Edition の locale だけを `originalLocale` にしていた
（[`apps/api/src/services/works.ts`](../../apps/api/src/services/works.ts)）。
`createInitialContentDocument` は `locale: SUPPORTED_LOCALES[0]`（ja-JP）を
固定で入れていた（[`packages/contracts/src/content/defaults.ts`](../../packages/contracts/src/content/defaults.ts)）。

`saveScriptVersion` は `content.locale` と Edition の locale の一致を必須とするため
（[`apps/api/src/services/script-versions.ts`](../../apps/api/src/services/script-versions.ts)）、
`work.create(locale: "en-US")` の直後に `script.edit` を呼ぶと
`VALIDATION_ERROR`（path は `content.locale`）になっていた。

[`apps/api/src/agent/character-socket-integration.test.ts`](../../apps/api/src/agent/character-socket-integration.test.ts)
には、修正前は次の回避コメント付きのテストがあった（現在は P1 の修正に
合わせて更新済み）。

> `work.create` seeds the initial document with the default locale, so align
> the document with the Edition before copying.

当時は `script.save` で `locale` を直した完全な ContentDocument を保存する
一手間が必要だったが、スキルには記載が無かった。`work.create` の `locale` は
エージェント公開入力なので、en-US を選ぶと踏んでいた。

**P1 で `createInitialContentDocument` を locale 引数対応にし、`work.create` が
指定 locale の初期台本を作るよう修正した。** `work-flow.test.ts` /
`defaults.test.ts` で en-US の作成直後の編集を固定している。

### 2.3 一括TTS → 確定の順序制約

- `tts.createBulk` の `requestId` は任意。付けた実行だけが冪等台帳に載り、
  `tts.attachBulk` で確定できる。付けない実行は確定できない。
- `tts.attachBulk` は `bulkRequestId` と、元の一括生成と同じ `agentId` を要求する。
  CLI で開始して MCP で確定する、といった束縛のまたぎは `RESOURCE_NOT_FOUND`。
- `createBulk` と `attachBulk` の間に台本を保存すると、元の版が current でなくなり
  `SCRIPT_BASE_STALE`。添付は全件成功時のみで、部分添付はしない。
- Job が1件でも未完了なら `pending` を返す。確定まで繰り返し呼ぶ。

これらは
[`docs/agent-access/spec.md`](../agent-access/spec.md) と
[`skills/kakeai-production/SKILL.md`](../../skills/kakeai-production/SKILL.md)
に記載がある。設計上の制約であり、守れば動く。ただし、
**手順を1つ飛ばすと一括生成全体が無駄になる**ため、MP4主線の中でもっとも
運用事故が起きやすい。

### 2.4 TTS・取り込みJobの回復（P2で一部解消）

修正前は `job.list` が作品のレンダー Job だけを返し、TTS と素材取り込みの
Job は一覧できなかった
（[`apps/api/src/services/jobs.ts`](../../apps/api/src/services/jobs.ts)）。

- `job.list` は P2 で `{ workId, kind? }` を受け、`kind: "tts"` で TTS Job を
  再発見できるようになった。HTTP の `GET /works/:workId/jobs` は既定の
  render のまま。
- `asset_ingest` は Work に紐づかないため `job.list` の対象外で、`job.get`
  で確認する。
- `tts.create` / `tts.createBulk` の応答を失った場合でも、`requestId` なしで
  開始した一括生成は再発見しても確定できない。`requestId` は契約上任意だが、
  確定には必須なので必ず付ける。
- 素材取り込みは内容ハッシュで重複排除されるため、再取り込みの実害は小さい。
- 完了した TTS Job は `ttsResult.narrationSegmentId` でセリフに対応づけられる。

### 2.5 再送・冪等の穴（P2で一部解消）

- `work.create` は `requestId` を持たない。タイムアウト後の再送で Work が
  増え得る。P2 では `requestId` を追加せず、`work.list` で確認してから
  再実行するガイド路線にした。
- `script.save` は `requestId` を持たない。P2 で任意の
  `baseScriptVersionId`（基準版ガード）と `sourceScriptVersionId`
  （同一 Edition の復元元）を追加した。基準版を指定しない場合は従来どおり
  last-write-wins で、再送すると版が増える。翻訳元の別 Edition は
  `sourceScriptVersionId` では記録できない。
- `asset.tag` はタグ全体の置換なので、読み→書きの間に人間が編集すると
  上書きする。
- 高コスト操作（`tts.create` / `tts.createBulk` / `render.start` /
  `composition.publish`）は `requestId` で冪等化される。
  `script.edit` と `tts.attachBulk` は版単位で冪等。

MP4主線は `script.edit` と `render.start(requestId)` を使うため、
この穴の影響は限定的である。全体取り込みで基準版ガードを使う運用は
ガイドに含める。

### 2.6 診断情報

エージェント向けの `health` 操作は無い。`/health` は HTTP のみで、
ワーカー状態・ストレージ警告・キューの混雑をエージェントから確認できない。

ただし、アプリ起動時は `worker.start()` の後にソケットを開くため、
ソケットが生きていればワーカーも起動済みである
（[`apps/api/src/index.ts`](../../apps/api/src/index.ts)）。
MP4主線では「Job が queued のまま進まない」ことを `job.get` で検知できれば
足りる。診断操作は P2 以降の改善候補とする。

## 3. MP4は出せるが、コスト・品質に効くもの

### 3.1 テンプレート入力の探索

`VisualCue.input` は契約上 `z.unknown()` で、テンプレート固有の検証は
保存時に `definition.inputSchema.safeParse` で行う
（[`packages/contracts/src/content/visual.ts`](../../packages/contracts/src/content/visual.ts)）。
`schema.get` はフィールド種別・選択肢・数値範囲を返すだけで、表・グラフ・フロー・
効果・`videoPlayback.gates` の入れ子JSONの形や例は返さないため、以前は
`VALIDATION_ERROR` を見ながらの試行錯誤が必要だった。

P3-1 で `template.get` を追加し、テンプレート1件について、保存時検証と同じ
Zod スキーマから導出した `inputSchema`（JSON Schema）と、そのスキーマを通る
`example` を返すようにした。`schema.get` の応答は増やさないので、複雑な入力を
使うときだけ1件取得すればよい。テンプレート定義の `inputSchema` が唯一の正で、
Agent 向けの第二の検証スキーマは持たない。

### 3.2 視覚確認

下書き・保存版のプレビュー HTML をエージェントが取得する操作は無い。
`preview.frame` はレンダー済み MP4 の静止画だけを返す
（[`docs/visual-confirmation/spec.md`](../visual-confirmation/spec.md)）。
今回の合格ラインでは最終確認を人間が行うため、これは blocker ではない。
ただし、エージェントが絵を自分で確認できないままレンダーを繰り返すと、
待ち時間とレンダー回数が増える。

### 3.3 Composition authoring

Composition の作成・publish は操作として揃っているが、絵の確認は
外部の `hyperframes check/snapshot` に依存する
（[`skills/kakeai-composition/SKILL.md`](../../skills/kakeai-composition/SKILL.md)）。
draft は部分更新のみでファイル削除ができず、256ファイル / 4MB / 16MB の
上限もある。MP4主線では、既存の VisualTemplate と既存の
CompositionVersion を使い、新規 Composition の authoring は
必要になった場合だけ行うのが安全である。

### 3.4 MCP/CLI の出力サイズ

MCP は成功時に同じ JSON を `content.text` と `structuredContent` の両方で返す。
`preview.frame` は `structuredContent` に `pngBase64` も含む
（[`apps/mcp/src/server.ts`](../../apps/mcp/src/server.ts)）。
`script.get` や `composition.draft.get` は大きな JSON を二重に返すため、
ホストが `structuredContent` を文脈へ入れる場合はトークン消費が大きい。
MP4主線では `preview.frame` を必須にしないことで、このコストを避けられる。

### 3.5 単一ワーカー

素材取り込み・TTS・レンダーは1本のキューを `createdAt` 昇順で流れる
（[`apps/api/src/worker/index.ts`](../../apps/api/src/worker/index.ts)）。
大量の一括TTSを積むと、レンダーはその後ろになる。MP4主線では
「TTSを完了させてからレンダー」の順序を守る。

## 4. 今回の非ゴール（人間または将来）

| 項目 | 今回の扱い | 理由 |
| --- | --- | --- |
| 最終的なレンダー確認・品質判断 | 人間 | 絵・音の判断は人間に残す |
| サムネイル | 人間 / 将来 | エージェント操作が無い。UIで作成・PNG取得できる |
| SRT字幕 | 人間 / 将来 | エージェント操作が無い。HTTPの字幕ダウンロードはある |
| YouTube投稿設定・チャプター | 人間 / 将来 | 現時点で未実装（[`docs/youtube-publication/plan.md`](../youtube-publication/plan.md)） |
| MP4 Artifact のダウンロード | 人間 / 将来 | Artifact content のエージェント操作が無い |
| 下書きプレビュー・視覚確認 | 将来 | レンダー前確認は別スコープ |
| 素材画像の確認 | 将来 | `assets/:id/frame` 相当のエージェント操作が無い |
| 版履歴・復元・Work複製 | 一部実装 / 将来 | 同一 Edition の復元は `script.save` の `sourceScriptVersionId` で可能。履歴一覧・Work複製は将来 |
| Theme / Face Set / Voice Profile の管理 | 将来 | 人専用の境界を維持 |
| 縦型（9:16）の完成動画 | 対象外 | 出力は 1920x1080。portrait は Composition の入れ子のみ |
| リモート/クラウド接続、アプリ自動起動 | 対象外 | 現行の非ゴール |

## 5. 分類

| 項目 | 分類 | MP4主線への影響 |
| --- | --- | --- |
| en-US の初期台本 | **解消済み（P1）** | P1 で修正済み。en-US でも作成直後から編集できる |
| 声の前提 | **設計上の制約 + 運用前提** | ライブラリに声付きキャラクターが無いと TTS 不可。人間プリフライトが必要 |
| 一括TTSの順序 | **設計上の制約** | 守れば動くが、飛ばすと一括生成が無駄になる。スキルとテストで固定 |
| TTS Job の回復 | **解消済み（P2）** | `job.list { kind: "tts" }` で再発見できる。`requestId` なしの一括は確定不可 |
| `work.create` / `script.save` の冪等 | **一部解消（P2）** | `script.save` は基準版ガード / source を追加。`work.create` は `work.list` 確認のガイド路線 |
| テンプレート入力の探索 | **解消済み（P3-1）** | `template.get` が入力 JSON Schema と検証済みの例を返す。推測せずに組み立てられる |
| 視覚確認 | **今回の非ゴール** | 人間が最終確認するため blocker ではない |
| Composition authoring | **今回の非ゴール** | 既存テンプレートでMP4を出す主線から外す |
| サムネイル / SRT / YouTube / Artifact取得 | **将来** | MP4の生成自体には不要 |
| 契約の後方互換 | **将来** | 同一バージョンで束縛とアプリを揃える前提 |

## 6. 根拠

- 操作カタログ: [`packages/contracts/src/agent.ts`](../../packages/contracts/src/agent.ts)
- MCP ツール: [`apps/mcp/src/tools.ts`](../../apps/mcp/src/tools.ts)
- 作品作成: [`apps/api/src/services/works.ts`](../../apps/api/src/services/works.ts)
- 初期台本: [`packages/contracts/src/content/defaults.ts`](../../packages/contracts/src/content/defaults.ts)
- 台本保存の locale 検証: [`apps/api/src/services/script-versions.ts`](../../apps/api/src/services/script-versions.ts)
- TTS の声検証: [`apps/api/src/services/tts-jobs.ts`](../../apps/api/src/services/tts-jobs.ts)
- Job 一覧: [`apps/api/src/services/jobs.ts`](../../apps/api/src/services/jobs.ts)
- ワーカー: [`apps/api/src/worker/index.ts`](../../apps/api/src/worker/index.ts)
- MCP 応答: [`apps/mcp/src/server.ts`](../../apps/mcp/src/server.ts)
- Agent Access 仕様: [`docs/agent-access/spec.md`](../agent-access/spec.md)
- 先行の信頼性改善: [`docs/agent-new-work/spec.md`](../agent-new-work/spec.md)
- 視覚確認: [`docs/visual-confirmation/spec.md`](../visual-confirmation/spec.md)
- 制作スキル: [`skills/kakeai-production/SKILL.md`](../../skills/kakeai-production/SKILL.md)
