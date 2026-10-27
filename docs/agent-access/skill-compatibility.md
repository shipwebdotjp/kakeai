# スキル互換性履歴

Kakeai のスキルは、本リポジトリの GitHub Release と対になる不変タグ `vMAJOR.MINOR.PATCH` からだけ導入する。この文書は、公開済みの各タグについて、対応する Kakeai リリース、含まれるスキル、各スキルが必須とする正規の Agent Access 操作名、互換性上の注意を記録する。

操作の入出力スキーマ、VisualTemplate の契約、`schemaDigest` / `operationDigest` の値はここへ複製しない。実行時の正は `schema.get`、`template.get`、MCP の `inputSchema`、CLI の検証である。

## v0.1.0

- 対応リリース: [`v0.1.0`](https://github.com/shipwebdotjp/kakeai/releases/tag/v0.1.0)（初回公開版）
- 導入元: `shipwebdotjp/kakeai#v0.1.0`
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

- スキルと Kakeai アプリは同じ公開タグに揃える。`v0.1.0` の制作スキルは `tts.attachBulk` を使うため、この操作を公開していないアプリでは `AGENT_OPERATION_UNKNOWN` になる。
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
