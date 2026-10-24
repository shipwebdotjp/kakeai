# エージェントMP4制作 調査結果

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
MP4主線を止めるのは編集APIではなく、次の3点である。

1. **声の前提**: 新規作品は話者を持たず、TTS は
   `speaker.voiceProfileId` を必須とする。エージェントには Voice Profile を
   一覧・作成・話者へ割り当てる操作が無い。声付きキャラクターを
   ライブラリからコピーするのが唯一の正規経路で、ライブラリに該当が無いと
   人間の事前設定なしには TTS できない。
2. **en-US の初期台本**: `work.create` は Edition の locale だけを指定値にし、
   初期台本は常に ja-JP で作る。en-US 作品の最初の `script.edit` は
   locale 不一致で失敗する。
3. **一括TTSの順序制約**: `requestId` なしの `tts.createBulk` は確定できず、
   `createBulk` と `attachBulk` の間の台本保存は `SCRIPT_BASE_STALE` で
   全滅する。同じ `agentId` で確定する必要がある。

この3点を除けば、MP4を出すための操作は存在する。視覚確認、サムネイル、
字幕、YouTube 設定は今回のスコープ外であり、MP4主線の blocker ではない。

## 1. 成立している部分

| 領域 | できること | 条件・補足 |
| --- | --- | --- |
| 作品・台本 | `work.create`（ja-JP）、`script.get`、`script.edit`、`script.validate`、`script.save` | `script.edit` は `baseScriptVersionId` と `requestId` で競合検出・冪等再送ができる |
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
既存 Speaker への `voiceProfileId` 割り当ても無い。正規の手段は
`character.addFromLibrary` で、声付きキャラクターを台本へコピーする
（`Speaker.voiceProfileId` は `Character.voices` の locale 一致から決まる）。
`character.list` の `voices` には `voiceProfileId` が含まれるため、
ライブラリに該当キャラクターがあれば、その ID を `script.save` で既存話者へ
設定する道はある。ただし、**新規インストールでライブラリが空の場合、
エージェントだけでは声を用意できない**。

既存作品ですでに TTS 対象の話者が有効な `voiceProfileId` を持っている場合は、
ライブラリのキャラクターを追加しなくても TTS できる。MP4主線の前提は
「新規作品なら声付きキャラクター、既存作品なら有効な `voiceProfileId`」と
整理するのが正確である。

`docs/agent-new-work/todo.md` の P0 実測でも、停止の支配因は
「話者/声未設定」と「`requestId` なしの一括TTS開始」と記録されている。

代替として、外部で生成した音声ファイルを `asset.import` し、
`line.assignTake` で台本へ入れることはできる。ただしこれは Kakeai の TTS を
使わない経路であり、MP4主線の標準手順ではない。

### 2.2 `work.create` の locale シード不具合

`createWork` は `createInitialContentDocument()` を常に ja-JP で作り、
Edition の locale だけを `originalLocale` にする
（[`apps/api/src/services/works.ts`](../../apps/api/src/services/works.ts)）。
`createInitialContentDocument` は `locale: SUPPORTED_LOCALES[0]`（ja-JP）を
固定で入れる（[`packages/contracts/src/content/defaults.ts`](../../packages/contracts/src/content/defaults.ts)）。

`saveScriptVersion` は `content.locale` と Edition の locale の一致を必須とするため
（[`apps/api/src/services/script-versions.ts`](../../apps/api/src/services/script-versions.ts)）、
`work.create(locale: "en-US")` の直後に `script.edit` を呼ぶと
`VALIDATION_ERROR`（path は `content.locale`）になる。

[`apps/api/src/agent/character-socket-integration.test.ts`](../../apps/api/src/agent/character-socket-integration.test.ts)
にも、次の回避コメント付きのテストがある。

> `work.create` seeds the initial document with the default locale, so align
> the document with the Edition before copying.

回避は `script.save` で `locale` を直した完全な ContentDocument を保存する
一手間だが、スキルには記載が無い。`work.create` の `locale` は
エージェント公開入力なので、en-US を選ぶと踏む。

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

### 2.4 TTS・取り込みJobの回復

`job.list` は作品のレンダー Job だけを返す
（[`apps/api/src/services/jobs.ts`](../../apps/api/src/services/jobs.ts)）。
TTS と素材取り込みの Job は一覧できない。

- `tts.create` / `tts.createBulk` の応答をタイムアウトで失い、
  `requestId` も付けていなかった場合、Job ID を再発見できない。
  `job.get` は ID 必須なので、二重生成するしかない。
- 素材取り込みは内容ハッシュで重複排除されるため、再取り込みの実害は小さい。
- TTS は生成 Asset が残っても、どの Job がどのセリフに対応するかを
  復元できない。

`docs/agent-access/roadmap.md` でも「`job.list` はレンダー Job のみ」は
既知の制約として挙げられている。MP4主線では、`requestId` を必ず付ける運用で
回避するのが最小解になる。

### 2.5 再送・冪等の穴

- `work.create` は `requestId` を持たない。タイムアウト後の再送で Work が
  増え得る。`work.list` で確認できるが、同名 Work が並ぶ。
- `script.save` は `requestId` を持たず、基準版のガードも無い。
  全体置換の last-write-wins で、再送すると版が増え、
  人間が同時編集していると上書きする。復元の系統
  （`sourceScriptVersionId`）もエージェント入力には無い。
- `asset.tag` はタグ全体の置換なので、読み→書きの間に人間が編集すると
  上書きする。
- 高コスト操作（`tts.create` / `tts.createBulk` / `render.start` /
  `composition.publish`）は `requestId` で冪等化される。
  `script.edit` と `tts.attachBulk` は版単位で冪等。

MP4主線は `script.edit` と `render.start(requestId)` を使うため、
この穴の影響は限定的である。翻訳・全体取り込み・復元をエージェントに
任せる段階で効いてくる。

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
`schema.get` はフィールド種別・選択肢・数値範囲を返すが、表・グラフ・フロー・
効果・`videoPlayback.gates` の入れ子JSONの形や例は返さない
（[`packages/contracts/src/agent.ts`](../../packages/contracts/src/agent.ts)）。

基本的なテキスト・画像・動画の Cue は比較的素直に作れる。一方、
`chart.*` / `table.*` / `flow.diagram` / 効果トリガーを使い始めると、
`VALIDATION_ERROR` を見ながらの試行錯誤になる。MP4を出すだけなら
必須ではないが、表現の幅を出すほど反復が増える。

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
| 版履歴・復元・Work複製 | 将来 | エージェント操作が無い |
| Theme / Face Set / Voice Profile の管理 | 将来 | 人専用の境界を維持 |
| 縦型（9:16）の完成動画 | 対象外 | 出力は 1920x1080。portrait は Composition の入れ子のみ |
| リモート/クラウド接続、アプリ自動起動 | 対象外 | 現行の非ゴール |

## 5. 分類

| 項目 | 分類 | MP4主線への影響 |
| --- | --- | --- |
| en-US の初期台本 | **バグ** | en-US を選ぶと最初の保存で止まる。修正必須 |
| 声の前提 | **設計上の制約 + 運用前提** | ライブラリに声付きキャラクターが無いと TTS 不可。人間プリフライトが必要 |
| 一括TTSの順序 | **設計上の制約** | 守れば動くが、飛ばすと一括生成が無駄になる。スキルとテストで固定 |
| TTS Job の回復 | **既知の制約** | `requestId` を必ず付ける運用で回避。P2で `job.list` 拡張を検討 |
| `work.create` / `script.save` の冪等 | **改善候補** | MP4主線では `script.edit` を使うため影響限定。P2 |
| テンプレート入力の探索 | **コスト** | 基本テンプレートなら影響小。複雑な表現で反復増 |
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
