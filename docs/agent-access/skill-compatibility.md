# スキル互換性履歴

Kakeai のスキルは、本リポジトリの GitHub Release と対になる不変タグ `vMAJOR.MINOR.PATCH` からだけ導入する。この文書は、公開済みの各タグについて、対応する Kakeai リリース、含まれるスキル、各スキルが必須とする正規の Agent Access 操作名、互換性上の注意を記録する。

操作の入出力スキーマ、VisualTemplate の契約、`schemaDigest` / `operationDigest` の値はここへ複製しない。実行時の正は `schema.get`、`template.get`、MCP の `inputSchema`、CLI の検証である。

## v0.4.0

- 対応リリース: [`v0.4.0`](https://github.com/shipwebdotjp/kakeai/releases/tag/v0.4.0)
- 導入元: `shipwebdotjp/kakeai#v0.4.0`
- Agent Access プロトコル: `2`（`minProtocolVersion` / `protocolVersion` とも `2`）
- 含まれるスキル: `kakeai-production`、`kakeai-composition`

### 必須の正規操作

`kakeai-production`:

- 基盤: `schema.get`、`template.get`
- 作品と台本: `work.create`、`work.update`、`work.clone`、`work.list`、`edition.create`、`script.get`、`script.save`、`script.edit`、`script.validate`、`script.listVersions`、`script.diff`、`script.restore`、`script.subtitles`
- 素材: `asset.list`、`asset.get`、`asset.import`、`asset.update`
- キャラクターと声: `character.list`、`character.get`、`character.create`、`character.update`、`character.addAppearance`、`character.updateAppearance`、`character.setVoices`、`voiceAdapter.list`、`voiceProfile.list`、`voiceProfile.get`、`voiceProfile.listVoices`、`voiceProfile.listModels`、`voiceProfile.create`、`voiceProfile.update`
- 表情とテーマ: `faceSet.get`、`theme.list`、`theme.get`
- 音声合成: `tts.create`、`tts.createBulk`、`tts.attachBulk`
- レンダーと納品: `render.start`、`job.get`、`job.list`、`artifact.get`、`artifact.export`

`kakeai-production` の任意操作:

- 表情・テーマの編集: `faceSet.list`、`faceSet.create`、`faceSet.update`、`faceSet.usages`、`theme.create`、`theme.draft.get`、`theme.draft.save`、`theme.diagnose`、`theme.publish`、`font.list`
- レンダー前後の確認: `preview.scriptFrame`、`preview.assetFrame`、`preview.frame`、`preview.faceSet`、`preview.theme`
- サムネイル: `thumbnail.listTemplates`、`thumbnail.list`、`thumbnail.create`、`thumbnail.update`、`thumbnail.setPrimary`、`thumbnail.image`、`preview.thumbnail`

`kakeai-composition`:

- 基盤: `schema.get`、`template.get`
- 作品と Composition: `work.list`、`work.get`、`composition.list`、`composition.get`、`composition.draft.get`、`composition.authoringContext`、`composition.create`、`composition.draft.update`、`composition.publish`
- 台本からの参照: `script.edit`、`script.validate`
- レンダー: `render.start`、`job.get`

`job.wait`（MCP の `kakeai_job_wait`）は束縛の便宜ツールであり、Agent 操作ではないため含めない。`standing.state.upsert` / `standing.state.remove`、`character.addFromLibrary`、`line.assignTake`、`speaker.add` などは Script Operation であり、Agent 操作名ではない。制作スキルはこれらを `script.edit` の中で使う。

### 互換性上の注意

- Agent Access プロトコルは `v0.3.0` と同じ `2` だが、アプリ、MCP/CLI 束縛、スキルは同じ公開タグに揃える。`v0.2.0` 以前の束縛（プロトコル `1`）は handshake で `AGENT_PROTOCOL_MISMATCH` になる。
- `kakeai-production` は、引き継ぎ時の保存済み ScriptVersion 比較に `script.diff` を使う。これを公開しない `v0.3.0` 以前のアプリへ `v0.4.0` のスキルを導入すると `AGENT_OPERATION_UNKNOWN` になる。
- `preview.scriptFrame` は保存済み版で `lineId` と任意の `offsetMs` による時刻指定を受け付ける。`timeMs` と `lineId` を同時に渡さない。旧版アプリでは行基準指定を使えない。
- Point Scene の新規追加は空の Cue から始まる。必要なテキスト Cue は `cue.add` で追加する。`scene.splitAtLine` は、明示的な立ち絵状態がなくても分割地点で表示中の基本立ち絵を引き継ぐ。
- サムネイルの `backgroundAssetId` と `foregroundAssetId` は任意になった。送る場合だけ ready な画像 Asset でなければならない。背景 Composition は Cue 範囲と manifest 尺の短い方で終わるため、Cue 範囲を manifest 尺に合わせ、`composition_shorter_than_range` を確認する。
- 公開済みの `v*` タグは更新も削除もしない。スキル本文の修正は新しいタグで公開する。

## v0.3.0

- 対応リリース: [`v0.3.0`](https://github.com/shipwebdotjp/kakeai/releases/tag/v0.3.0)
- 導入元: `shipwebdotjp/kakeai#v0.3.0`
- Agent Access プロトコル: `2`（`minProtocolVersion` / `protocolVersion` とも `2`）
- 含まれるスキル: `kakeai-production`、`kakeai-composition`

### 必須の正規操作

`kakeai-production`:

- 基盤: `schema.get`、`template.get`
- 作品と台本: `work.create`、`work.update`、`work.clone`、`work.list`、`edition.create`、`script.get`、`script.save`、`script.edit`、`script.validate`、`script.listVersions`、`script.restore`、`script.subtitles`
- 素材: `asset.list`、`asset.get`、`asset.import`、`asset.update`
- キャラクターと声: `character.list`、`character.get`、`character.create`、`character.update`、`character.addAppearance`、`character.updateAppearance`、`character.setVoices`、`voiceAdapter.list`、`voiceProfile.list`、`voiceProfile.get`、`voiceProfile.listVoices`、`voiceProfile.listModels`、`voiceProfile.create`、`voiceProfile.update`
- 表情とテーマ: `faceSet.get`、`theme.list`、`theme.get`
- 音声合成: `tts.create`、`tts.createBulk`、`tts.attachBulk`
- レンダーと納品: `render.start`、`job.get`、`job.list`、`artifact.get`、`artifact.export`

`kakeai-production` の任意操作:

- 表情・テーマの編集: `faceSet.list`、`faceSet.create`、`faceSet.update`、`faceSet.usages`、`theme.create`、`theme.draft.get`、`theme.draft.save`、`theme.diagnose`、`theme.publish`、`font.list`
- レンダー前後の確認: `preview.scriptFrame`、`preview.assetFrame`、`preview.frame`、`preview.faceSet`、`preview.theme`
- サムネイル: `thumbnail.listTemplates`、`thumbnail.list`、`thumbnail.create`、`thumbnail.update`、`thumbnail.setPrimary`、`thumbnail.image`、`preview.thumbnail`

`kakeai-composition`:

- 基盤: `schema.get`、`template.get`
- 作品と Composition: `work.list`、`work.get`、`composition.list`、`composition.get`、`composition.draft.get`、`composition.authoringContext`、`composition.create`、`composition.draft.update`、`composition.publish`
- 台本からの参照: `script.edit`、`script.validate`
- レンダー: `render.start`、`job.get`

`job.wait`（MCP の `kakeai_job_wait`）は束縛の便宜ツールであり、Agent 操作ではないため含めない。`standing.state.upsert` / `standing.state.remove`、`character.addFromLibrary`、`line.assignTake`、`speaker.add` などは Script Operation であり、Agent 操作名ではない。制作スキルはこれらを `script.edit` の中で使う。

### 互換性上の注意

- `v0.3.0` のアプリは Agent Access プロトコル `2` のため、`v0.2.0` 以前の MCP/CLI 束縛（プロトコル `1`）は接続時の handshake で `PROTOCOL_MISMATCH` になる。アプリと束縛は同じ公開タグに揃える。
- スキルはアプリと別に配布される。`v0.2.0` のスキルを `v0.3.0` のアプリで使うことはできるが、立ち絵状態や外観の標準配置などの新機能は使えない。逆に `v0.3.0` のスキルを `v0.2.0` のアプリで使うと、`script.edit` の `standing.state.upsert` / `standing.state.remove` や `CharacterAppearance.standing` を必要とする操作が失敗する。
- 制作スキルは、セリフ境界の立ち絵状態を `script.edit` の `standing.state.upsert` / `standing.state.remove` で、外観の標準配置を `CharacterAppearance.standing` で扱う。アプリの Script Operation 契約がこれらに対応している必要がある。
- `character.update` は `name` / `names` / `voices` の部分更新だけを扱い、外観は `character.addAppearance` / `character.updateAppearance` で変更する。`label: null` と `faceSetId: null` は解除、`standing` は `{ scale, edge, vertical }` をまとめて置き換える。
- MCP のツール説明と `instructions` は英語に統一した。ツール名・入力スキーマ・操作名は変えていないため、互換性への影響はない。
- 公開済みの `v*` タグは更新も削除もしない。スキル本文の修正は新しいパッチ版タグで行う。

## v0.2.0

- 対応リリース: [`v0.2.0`](https://github.com/shipwebdotjp/kakeai/releases/tag/v0.2.0)（初回公開版）
- 導入元: `shipwebdotjp/kakeai#v0.2.0`
- Agent Access プロトコル: `1`（`minProtocolVersion` / `protocolVersion` とも `1`）
- 含まれるスキル: `kakeai-production`、`kakeai-composition`

### 必須の正規操作

`kakeai-production`:

- 基盤: `schema.get`、`template.get`
- 作品と台本: `work.create`、`work.update`、`work.clone`、`work.list`、`edition.create`、`script.get`、`script.save`、`script.edit`、`script.validate`、`script.listVersions`、`script.restore`
- 素材: `asset.list`、`asset.get`、`asset.import`、`asset.update`
- キャラクターとライブラリ: `character.list`、`character.get`、`voiceProfile.list`、`voiceProfile.get`、`theme.list`、`theme.get`、`faceSet.get`
- 音声合成: `tts.create`、`tts.createBulk`、`tts.attachBulk`
- レンダー: `render.start`、`job.get`、`job.list`

`kakeai-production` の任意操作:

- `preview.scriptFrame`、`preview.assetFrame`: レンダー前の構図確認。MP4 の合格ラインには含まない。
- `preview.frame`: render 後の静止画確認。MP4 の合格ラインには含まない。

`kakeai-composition`:

- 基盤: `schema.get`、`template.get`
- Composition: `composition.list`、`composition.get`、`composition.draft.get`、`composition.authoringContext`、`composition.create`、`composition.draft.update`、`composition.publish`
- 台本からの参照: `script.edit`、`script.validate`
- レンダー: `render.start`、`job.get`

`job.wait`（MCP の `kakeai_job_wait`）は束縛の便宜ツールであり、Agent 操作ではないため含めない。`line.assignTake`、`speaker.add`、`character.addFromLibrary` などは Script Operation であり、Agent 操作名ではない。

### 互換性上の注意

- スキルと Kakeai アプリは同じ公開タグに揃える。`v0.2.0` の制作スキルは `tts.attachBulk` を使うため、この操作を公開していないアプリでは `AGENT_OPERATION_UNKNOWN` になる。
- `kakeai-composition` は Composition authoring（`composition.*`）を必要とする。Composition Library を持たない版では使えない。
- `skills@1.7.4` のロックからの復元コマンドは `experimental_install` である。`install` というコマンドはこの版にない。
- `skills update` はロックの `ref` を新しい Kakeai タグへ進めない。更新は新しいタグを指定して `add` を再実行する。
- グローバル導入（`-g`）は `skills-lock.json` を作らない。プロジェクト導入だけがロックによる復元の対象である。
- `skills-lock.json` は `skills` CLI の生成物であり、手で編集しない。`ref` が意図した公開タグを指していることだけをレビューする。
- 公開済みの `v*` タグは更新も削除もしない。スキル本文の修正は新しいパッチ版タグで行う。
- リリース workflow は、このファイルに `## vX.Y.Z` のエントリがない限りタグと GitHub Release を作らない。

## 新しいタグを追加するとき

1. リリース対象の `main` のコミットで、このファイルに `## vX.Y.Z` を追加する。
2. 対応する Kakeai リリース、導入元の ref、含まれるスキル、各スキルの必須操作、互換性上の注意を記録する。操作スキーマやダイジェスト値は書かない。
3. release workflow を手動で起動し、`MAJOR.MINOR.PATCH` 形式の版を入力する。
4. workflow が互換性履歴のエントリ、型検査、全テスト、スキル発見を確認した後、同じコミットから注釈付きタグと GitHub Release を作る。
5. 公開後、空のワークスペースへ `add` し、`skills-lock.json` の `ref` が新しいタグを指すことと、`experimental_install` で復元できることを確認する。
