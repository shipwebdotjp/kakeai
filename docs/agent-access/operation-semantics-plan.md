# Agent 操作の set/update 命名統一 実装計画

Status: implementation plan（実装者向け。確定仕様ではない）

この文書は、Agent Access と Script Operation の操作名・更新意味を
「`set` = 名前で示した値の全置換 / `update` = 部分更新」に揃えるための
実装計画である。実装時は `docs/agent-access/spec.md` と
`docs/editor-core/spec.md` を正とし、この計画の内容を反映する。

## 1. 目的

操作名から「何を置き換え、何を維持するか」を読み取れるようにする。
特に次の事故を契約で防ぐ。

- 一部だけ変更したいのに、配列全体を送り直して他の要素を消す。
- `faceSetId` や `label` を書き忘れて、暗黙に解除する。
- `set` と `update` の意味が操作ごとに違い、呼び出し側が推測する。
- 同名の操作が、ある版では部分更新、別の版では全置換になる。

## 2. 決定事項

### 2.1 命名規則

| 動詞 | 意味 | 例 |
| --- | --- | --- |
| `set` | 操作名で示した**値**を全体置換する。その値以外は変更しない。空配列は全解除、`null` は解除を許す項目だけ解除 | `character.setVoices`、`thumbnail.setPrimary`、`cue.setInput`、`document.setCaption` |
| `update` | 対象リソースの**指定した項目だけ**を変更する。省略した項目は不変。指定した配列・オブジェクトは、明記した例外を除き全体置換 | `character.update`、`thumbnail.update`、`voiceProfile.update`、`audio.update` |
| `upsert` | 自然キーで指定した位置に、無ければ作成し、あれば部分更新する | `standing.upsert` |
| `save` | 文書・Draft 全体を保存する。部分更新には使わない | `script.save`、`theme.draft.save` |
| `create` / `add` / `remove` / `publish` など | 従来どおり。`set` / `update` の規則の対象外 | — |

重要な点:

- `set` は「リソース全体の置換」ではない。**名前に含まれる値の置換**である。
  例えば `character.setVoices` は声だけを置換し、名前・外観は変えない。
- `update` の入れ子は、原則として指定したオブジェクトを丸ごと置換する。
  子オブジェクトの単位は操作ごとの仕様で定め、既定は全体置換とする。
  既知の例外は `cue.updateInput`（深いマージ）と
  `composition.draft.update`（ファイル単位・manifest 項目単位）である。
- 配列は、指定された時点で全体置換である。要素単位の変更は
  専用操作（`character.updateAppearance` など）を使う。
- 空配列・空オブジェクト・`null` の意味は、操作ごとに仕様へ明記する。
  特に `null` は「解除」を許す項目だけに使い、必須項目には使わない。

### 2.2 互換性とプロトコル版

本アプリは単一利用者向けで、アプリ・MCP・CLI・スキルを同じ変更で更新する。
したがって今回の操作名・意味の変更では、旧クライアントとの互換性を保証しない。

- 旧名の別名、旧契約の受け付け、移行レイヤーは作らない。
- `AGENT_PROTOCOL_VERSION` と `AGENT_PROTOCOL_MIN_VERSION` は `1` のまま据え置く。
  ソケットの要求・応答エンベロープの形式は変えないためである。
- `schemaDigest` / `operationDigest` は契約変更に伴って変わる。
  これは変更検知には使うが、接続時の互換性保証とは扱わない。
- 古いスキルや束縛が接続した場合は、入力検証エラーまたは
  `AGENT_OPERATION_UNKNOWN` になる。版不一致による明示的な拒否はしない。

この判断は既存の「破壊的変更ではプロトコル版を上げる」規則を変更するため、
新しい ADR に記録する。

## 3. 操作の棚卸し

### 3.1 Agent Access

| 操作 | 変更 | 内容 |
| --- | --- | --- |
| `asset.update` | **削除** | `asset.update` に統合する。`asset.setTags` は新設しない |
| `asset.update` | 拡張 | `tags` / `favorited` / `archived` の部分更新。指定した `tags` は配列全体を置換 |
| `character.update` | 縮小 | `appearances` を外す。`name` / `names` / `voices` の部分更新だけにする |
| `character.setVoices` | 維持 | `voices` 配列の全置換。空配列で全解除 |
| `character.addAppearance` | 維持 | 外観 1 件追加 |
| `character.updateAppearance` | 維持 | 外観 1 件の部分更新。省略は維持、`null` は解除 |
| `thumbnail.update` | **意味変更** | 全項目必須の保存から、省略＝維持の部分更新へ |
| `voiceProfile.update` | **意味変更** | 全項目必須から、省略＝維持の部分更新へ |
| `composition.draft.update` | **改名** | `composition.draft.update`。実装は既に部分更新 |
| `faceSet.update` | 維持 | 部分更新。指定した配列は全体置換 |
| `work.update` | 維持 | `title` だけを変更する部分更新 |
| `theme.draft.save` | 維持 | 完全な `definition` を保存する。Draft が無ければ作る |
| `thumbnail.setPrimary` | 維持 | primary の設定・`null` 解除 |
| `script.save` | 維持 | ContentDocument 全体の保存 |
| その他の `list` / `get` / `create` / `publish` など | 維持 | 変更なし |

`composition.draft.update` は名前が `save` でも実装は部分更新なので、
`save` の規約に合わせて `composition.draft.update` に改名し、今回の
一括変更に含める。

`character.update` から外す理由:

- ライブラリ外観の配列全体を送る操作は、`id` の送り忘れで作品コピーの
  リンクを切り、`faceSetId` / `label` の書き忘れで暗黙解除を起こす。
- 1 件の追加・更新は `character.addAppearance` / `character.updateAppearance`
  で足りる。
- エージェントによる外観の間接削除は公開しない。削除は人専用のままにする。
- 作品へコピー済みの Character は、この変更の対象外である。ライブラリの
  更新は既存の Script Version やコピーへ自動では波及しない。

### 3.2 Script Operation

| 操作 | 変更 | 内容 |
| --- | --- | --- |
| `audio.update` | **改名** | `audio.update`。部分更新の意味は変えない |
| `line.updateText` | **改名** | `line.updateText`。字幕・読み上げ文の部分更新 |
| `cue.updateTransition` | **改名** | `cue.updateTransition`。enter / exit の部分更新 |
| `cue.setInput` | **意味変更** | 常に入力全体を置換する。`replace` フラグを削除 |
| `cue.updateInput` | **新設** | 入力の部分更新。plain object は深くマージし、配列・プリミティブ・`null` は置換 |
| `standing.upsert` | **改名** | `standing.upsert`。作成または部分更新であることを名前に出す |
| `scene.setLabel` / `setAccent` / `setTiming` / `setTransition` | 維持 | 名前で示した値を置換 |
| `line.setSpeaker` / `setExpression` / `setGap` | 維持 | 名前で示した値を置換 |
| `cue.setRange` / `setPlacement` | 維持 | 範囲・配置の値を置換 |
| `speaker.setVoiceProfile` | 維持 | 割り当て値の置換。`null` は解除 |
| `document.setVisualTheme` / `setCaption` | 維持 | 名前で示した値を置換 |
| `line.selectTake` / `assignTake` / `removeTake` | 維持 | 選択・追加・削除の操作 |
| `scene.*` / `line.*` / `cue.*` の add / remove / move / copy / split | 維持 | 変更なし |

`standing.upsert` の理由:

- 指定した `side` に立ち絵が無ければ作成し、あれば更新する。
- 既存時は `scale` / `edge` / `vertical` の省略を既存値で維持する。
- 作成時は省略値を既定値（`1` / `margin` / `standard`）で埋める。
- 「作成も更新もする」ため、部分更新だけを意味する `update` より
  `upsert` が実態に合う。

### 3.3 変更しないもの

- HTTP API の入力契約・URL・サービス名は変更しない。
- DB スキーマ、Prisma migration、保存済み Script Version は変更しない。
- Web UI の画面構成・表示文言は変更しない。操作名の呼び出しだけを変える。
- `asset.delete`、`character.delete`、`faceSet.delete`、`voiceProfile.delete` は
  引き続き公開しない。
- `theme.draft.save` は完全な定義を受け取るため `save` のままとする。
- `composition.publish` の `dryRun` など、既存の意味は変えない。

## 4. 詳細契約

### 4.1 `asset.update`

入力:

```json
{
  "assetId": "asset-123",
  "tags": ["背景", "青"],
  "favorited": true,
  "archived": false
}
```

- `tags` / `favorited` / `archived` はすべて任意。少なくとも 1 項目を必須。
- `tags` を指定した場合は配列全体を置換する。`[]` は全解除。
- `tags` の正規化・件数・長さの検証は既存の `assetTagsSchema` を使う。
- `favorited` / `archived` は既存の `updateAsset` の意味を変えない。
- `asset.update` は削除する。`asset.setTags` も作らない。
- タイムアウト後は `asset.get` で確認してから再実行する。`requestId` は持たない。

### 4.2 `character.update`

入力:

```json
{
  "characterId": "chr-123",
  "name": "新しい名前",
  "names": [{ "locale": "ja-JP", "name": "新しい名前" }],
  "voices": [{ "locale": "ja-JP", "voiceProfileId": "vp-1" }]
}
```

- `name` / `names` / `voices` は任意。少なくとも 1 項目を必須。
- 省略した項目は不変。指定した配列は全体置換。
- `appearances` は入力に含めない。`strictObject` により旧フィールドは
  `VALIDATION_ERROR` になる。
- 外観の追加は `character.addAppearance`、1 件更新は
  `character.updateAppearance` を使う。
- `updateCharacterPartial` から `appearances` の分岐と
  `AgentCharacterUpdateAppearanceInput` 依存を削除する。Prisma の更新データから
  `appearances` の `deleteMany` / `create` も外し、外観には一切触れない。
- HTTP の `updateCharacter`（全項目更新）は変更しない。`character.create` の
  `appearances` も変更しない。
- 読み取り・マージ・検証・書き込みは同じトランザクション内で行う。

### 4.3 `thumbnail.update`

入力:

```json
{
  "thumbnailId": "thumb-123",
  "label": "候補2 改",
  "template": { "id": "...", "version": 1 },
  "input": { "...": "..." },
  "appearanceOverride": { "headline": { "color": "#FF00FF" } }
}
```

- `label` / `template` / `input` / `appearanceOverride` はすべて任意。
  少なくとも 1 項目を必須。
- `label` を指定する場合は空でない文字列。
- `template` / `input` の片方だけを指定した場合は、現在値で補ってから
  組み合わせを検証する。テンプレート変更後に旧 `input` が適合しなければ
  `VALIDATION_ERROR`。
- `appearanceOverride`:
  - 省略: 現在の override を維持する。
  - `null`: override を全解除する。
  - オブジェクト: override 全体を置換する（部分マージしない）。
- 現在行の読み取り、マージ、テンプレート検証、Asset 検証、書き込みは
  同一トランザクションで行う。
- `thumbnail.create` は従来どおり `label` / `template` / `input` 必須。
- `requestId` は持たない。タイムアウト後は `thumbnail.list` / `get` で確認する。

注意: 現行の `thumbnail.update` は `appearanceOverride` を省略すると解除する。
この挙動を「省略＝維持」に変えるため、既存の呼び出しとテストを更新する。
解除したい呼び出しは明示的に `null` を送る。

### 4.4 `voiceProfile.update`

入力:

```json
{
  "voiceProfileId": "vp-123",
  "name": "新しい名前",
  "voiceId": "voice-1",
  "locale": "ja-JP",
  "settings": { "model": "..." }
}
```

- `name` / `voiceId` / `locale` / `settings` は任意。少なくとも 1 項目を必須。
- `adapterId` は変更できない（従来どおり）。
- 省略した項目は不変。
- `settings` を指定した場合は、そのアダプターの設定オブジェクト全体を置換する。
  部分マージはしない。`openai-compatible` の `model` など必須項目が欠ければ
  `VALIDATION_ERROR`。
- 参照音声 `refAudioAssetId` の検証は既存処理を使う。
- 現在値の読み取り・マージ・検証・更新は同一トランザクションで行う。
- HTTP の `updateVoiceProfile`（全項目必須）は変更しない。エージェント用に
  `updateVoiceProfilePartial` を追加する。

### 4.5 `cue.setInput` / `cue.updateInput`

`cue.setInput`:

```json
{
  "op": "cue.setInput",
  "sceneId": "scene-1",
  "cueId": "cue-1",
  "input": { "...": "..." }
}
```

- `input` 全体を置換する。
- `replace` フィールドは削除する。
- 置換後の入力をテンプレートの入力スキーマで検証する。

`cue.updateInput`:

```json
{
  "op": "cue.updateInput",
  "sceneId": "scene-1",
  "cueId": "cue-1",
  "input": { "headline": "追記" }
}
```

- plain object は深くマージする。
- 配列・プリミティブ・`null` は置換する。
- マージ後の入力をテンプレートの入力スキーマで検証する。
- 深いマージはこの操作の明示例外とし、他の `update` では行わない。
  `composition.draft.update` のファイル単位・manifest 項目単位の更新も
  別の明示例外である。

Web UI の `commitCueStructural` は現在 `replace: true` を付けているため、
`cue.setInput` から `replace` を外すだけで同じ全体置換になる。

### 4.6 `standing.upsert`

入力は旧 `standing.upsert` と同じ。

- `sceneId` / `side` / `characterId` / `appearanceId` は必須。
- `scale` / `edge` / `vertical` / `transition` は任意。
- 既存の立ち絵がある場合:
  - `scale` 省略時は既存値、なければ `1`。
  - `edge` 省略時は既存値、なければ `margin`。
  - `vertical` 省略時は既存値、なければ `standard`。
  - `transition` を指定した場合は enter / exit をまとめて置換する。
- 立ち絵が無い場合は作成し、省略値は既定値で埋める。
- 内部 Cue の ID と order は既存時は維持する。

### 4.7 `composition.draft.update`

- `composition.draft.update` を `composition.draft.update` に改名する。
- 入力・出力・サービス呼び出しは変えない。既存の
  `updateCompositionDraftRequestSchema` は部分更新である。
- `files` / `filesBase64` はパス単位で追加・置換し、指定しないパスは残る。
  `manifest` は指定した項目だけを現在値に重ねる。このファイルツリー固有の
  部分更新は明示例外として仕様に書く。
- `composition.create` / `composition.publish` は変更しない。

## 5. 実装手順

操作名は契約が正なので、`packages/contracts` から変更し、型検査で
呼び出し側を洗い出す。以下は 1 つの変更セットとして扱う。

### 5.1 契約

- `packages/contracts/src/script-operation.ts`
  - `audio.update` → `audio.update`
  - `line.updateText` → `line.updateText`
  - `cue.updateTransition` → `cue.updateTransition`
  - `cue.setInput` から `replace` を削除
  - `cue.updateInput` を追加
  - `standing.upsert` → `standing.upsert`
  - `scriptOperationSchemas` / `scriptOperationNames` / 型エクスポートを更新
- `packages/contracts/src/agent/operations.ts`
  - `agentAssetTagInputSchema` / `agentAssetTagOutputSchema` を削除
  - `agentAssetUpdateInputSchema` を `tags` / `favorited` / `archived` の
    「少なくとも 1 項目」に変更
  - `agentCharacterUpdateInputSchema` から `appearances` を削除
  - `agentCharacterUpdateAppearanceInputSchema` と
    `AgentCharacterUpdateAppearanceInput` を削除
  - `agentThumbnailUpdateInputSchema` を部分更新契約へ変更
  - `agentVoiceProfileUpdateInputSchema` を部分更新契約へ変更
  - Composition Draft の入出力スキーマ名を `...Update...` に改名
- `packages/contracts/src/agent/catalog.ts`
  - `asset.update` を全リストから削除
  - `composition.draft.update` → `composition.draft.update`
  - read / mutation の分類を更新
- `packages/contracts/src/agent/maps.ts`
  - 上記の操作キーとスキーマ名を更新
- `packages/contracts/src/agent/thumbnail-schemas.ts`
  - 部分更新用の入力スキーマを定義（HTTP の全項目 `save` とは分ける）
- `packages/contracts/src/agent-operations.test.ts`
  - 操作カタログ、`asset.update`、`character.update`、
    `thumbnail.update`、`voiceProfile.update`、Composition Draft の契約を更新

### 5.2 Script Operation Core

- `packages/script-edits/src/apply.ts`
  - 操作名の case を更新
  - `cue.setInput` は `replace` なしで全体置換
  - `cue.updateInput` はマージ
  - `standing.upsert` → `standing.upsert`
- `packages/script-edits/src/audio.ts`
  - `setAudio` → `updateAudio`（内部名も操作名に合わせる）
- `packages/script-edits/src/line.ts`
  - `setLineText` → `updateLineText`
- `packages/script-edits/src/cue.ts`
  - `setCueTransition` → `updateCueTransition`
  - `setCueInput` を全体置換に変更
  - `updateCueInput` を追加（既存の `mergeInput` を使う）
- `packages/script-edits/src/standing.ts`
  - `setStanding` → `upsertStanding`
- `packages/script-edits/src/*.test.ts`
  - 操作名を更新
  - `cue.setInput` が `replace` を受け付けず、全体置換になること
  - `cue.updateInput` が深くマージすること
  - `standing.upsert` の作成・既存値維持・既定値

### 5.3 API

- `apps/api/src/agent/operations.ts`
  - `asset.update` の定義を削除
  - `asset.update` から `updateAsset` に `tags` も渡す
  - Composition Draft の操作名を `composition.draft.update` に変更
- `apps/api/src/agent/library-operations.ts`
  - `updateCharacterFromAgent` から `appearances` を削除
  - `toUpdatedLibraryAppearance` が不要になれば削除
  - `voiceProfile.update` から `updateVoiceProfilePartial` を呼ぶ
- `apps/api/src/agent/thumbnail-operations.ts`
  - `thumbnail.update` から `updateThumbnailPartial` を呼ぶ
- `apps/api/src/services/character-library.ts`
  - `CharacterUpdatePatch` から `appearances` を削除
  - `updateCharacterPartial` の外観検証・置換分岐を削除
  - `updateCharacterPartial` の Prisma 更新データから `appearances` の
    `deleteMany` / `create` を外し、外観を保持する
  - `updateCharacter`（HTTP の全項目更新）と `createCharacter` は維持
- `apps/api/src/services/voice-profiles.ts`
  - `updateVoiceProfilePartial` を追加。現在行をトランザクション内で読み、
    省略項目を現在値で補い、アダプター設定を検証して更新する
- `apps/api/src/services/thumbnails.ts`
  - `updateThumbnailPartial` を追加。現在行をトランザクション内で読み、
    `inputJson` を `parseThumbnailDocument` で復元し、`label` / `template` /
    `input` / `appearanceOverride` をマージする。既存の `validateDocument` で
    検証して更新し、`isPrimary` は `saveThumbnail` と同じ規則で算出する
- `apps/api/src/agent/*.test.ts`、`apps/api/src/services/*.test.ts`
  - 操作名・部分更新・削除した操作の拒否を更新

### 5.4 Web UI

- `apps/web/src/content/structural/audio.ts`
  - `audio.update` → `audio.update`
  - `cue.setInput` の `replace: true` を削除
- `apps/web/src/content/structural/standing.ts`
  - `standing.upsert` → `standing.upsert`
- `apps/web/src/components/lines-editor/LineEditor.tsx`
  - `line.updateText` → `line.updateText`
- `apps/web/src/content/structural/*.test.ts`
  - 操作名と `cue.setInput` の全体置換を更新

### 5.5 MCP / CLI

- `apps/mcp/src/tools.ts`
  - `asset.update` の説明を削除
  - `asset.update` の説明に `tags` を追加
  - `character.update` から `appearances` の説明を削除
  - `thumbnail.update` / `voiceProfile.update` を部分更新の説明に変更
  - `composition.draft.update` に改名
  - `Record<AgentOperationName, string>` の網羅性で漏れを検出する
- `apps/cli/src` は操作カタログ導出のため、原則としてコード変更なし。
  テストの期待値を更新する。
- `apps/mcp/src/tools.test.ts`、`apps/cli/src/cli.test.ts`
  - 操作一覧・ツール名・`asset.update` の不存在を更新

### 5.6 ドキュメント・スキル

次の文書を新しい操作名と意味に更新する。ADR の本文は書き換えない。

- `docs/agent-access/spec.md`
  - 操作表から `asset.update` を削除
  - `composition.draft.update` に改名
  - `asset.update` / `character.update` / `thumbnail.update` /
    `voiceProfile.update` の詳細を更新
  - `set` / `update` / `upsert` / `save` の命名規則を追加
  - 互換性・プロトコル版の節を今回の方針に更新
- `docs/editor-core/spec.md`
  - 操作表と補足の `audio.update`、`line.updateText`、
    `cue.updateTransition`、`cue.setInput` / `cue.updateInput`、
    `standing.upsert` を更新
  - `cue.updateInput` の深いマージを明示例外として記載
- `docs/editor-core/todo.md`
  - 現在の操作名を更新（過去の完了記録は歴史として残す）
- `docs/agent-access/roadmap.md` / `todo.md`
  - C13 のタグの扱いを `asset.update` に統合する形へ更新
  - 今回の命名統一を新しい実施項目として追加
  - 完了済み項目に「`agentCharacterUpdateAppearanceInputSchema` を維持する」
    「`asset.update` を残す」など今回と逆の記述がある場合は、履歴を消さずに
    「ADR 0109 で廃止」と注記する
- `docs/agent-access/skill-compatibility.md`
  - 必須操作の一覧から `asset.update` を削除し、`composition.draft.update` に更新
  - 公開済みタグがある場合は、そのタグの互換性履歴を書き換えず、
    新しいリリースのエントリとして記録する
- `docs/agent-mp4-production/spec.md` / `findings.md` / `roadmap.md` / `todo.md`
  - 現在の手順に含まれる `asset.update`、`standing.upsert`、
    `character.update` の外観手順を更新
  - 「外観は `character.update` で追加」は
    「`character.addAppearance` で追加」に修正
- `docs/thumbnail/spec.md`
  - `thumbnail.update` の省略・`null`・全置換の意味を更新
- `docs/character-library/spec.md`
  - `character.update` から外観を外したことを反映
- `docs/tts/spec.md`
  - `voiceProfile.update` の部分更新を反映
- `docs/agent-new-work/spec.md`
  - `standing.upsert` → `standing.upsert`
- `docs/composition-library/spec.md` など
  - `composition.draft.update` の参照を `composition.draft.update` に更新
- `skills/kakeai-production/SKILL.md`
  - `asset.update` を `asset.update` に統合
  - `character.update` の外観手順を `addAppearance` / `updateAppearance` に変更
  - `standing.upsert` に更新
- `skills/kakeai-composition/SKILL.md`
  - `composition.draft.update` → `composition.draft.update`
- `user-guide/docs/agent-access.md`
  - MCP ツール表・操作詳細・タイムアウト手順を更新
- `user-guide/docs/composition-library.md`
  - `composition.draft.update` に更新
- `CONTEXT.md`
  - 用語として `Set Operation` / `Update Operation` / `Upsert Operation` /
    `Save Operation` を追加する。実装詳細は書かず、意味だけを定義する

### 5.7 ADR

新規: `docs/adr/0109-agent-operation-set-update-semantics.md`

記録する内容:

- `set` = 名前で示した値の全置換、`update` = 部分更新、`upsert` = 作成または
  部分更新、`save` = 文書全体の保存、という規則。
- `asset.update` を `asset.update` に統合し、`asset.setTags` を作らないこと。
- `character.update` から `appearances` を外し、`addAppearance` /
  `updateAppearance` に寄せること。
- `thumbnail.update` / `voiceProfile.update` を部分更新にすること。
- `composition.draft.update` を `composition.draft.update` に改名すること。
- Script Operation の改名、`cue.setInput` の全置換化と `cue.updateInput` の追加、
  `standing.upsert` への改名。
- 旧クライアントの互換性を保証せず、`AGENT_PROTOCOL_VERSION` を据え置くこと。
- Considered Options: 旧名の別名を残す、プロトコル版を上げる、
  `asset.update` を残す、`character.update` の配列置換を残す、
  `cue.setInput` の `replace` フラグを残す、など。
- Consequences: `operationDigest` / `schemaDigest` が変わる。DB migration と
  HTTP API の変更はない。スキル・ユーザーガイドを同時に更新する。

既存 ADR への追記（本文は変えない）:

- `docs/adr/0088-agent-voice-profile-writes.md`
  - `Amended by [ADR 0109]`（`voiceProfile.update` の部分更新化）
- `docs/adr/0098-agent-thumbnail-operations.md`
  - `Amended by [ADR 0109]`（`thumbnail.update` の部分更新化）
- `docs/adr/0099-agent-character-library-writes.md`
  - `Amended by [ADR 0109]`（`character.update` から `appearances` を削除）
- `docs/adr/0107-agent-asset-organization.md`
  - `Amended by [ADR 0109]`（`asset.update` を `asset.update` に統合）
- `docs/adr/0108-agent-character-appearance-diff-operations.md`
  - `Amended by [ADR 0109]`（互換性維持のための配列置換を廃止）

必要なら `docs/adr/0089-agent-character-set-voices.md` にも
「`setVoices` は命名規則に沿って維持」と追記する。ただし意味は変えないため
必須ではない。

## 6. テスト計画

### 6.1 契約

- `asset.update`: `tags` 単独、`tags: []`、`favorited` / `archived` との併用、
  0 項目拒否、未知フィールド拒否。
- `asset.update` がカタログ・入力マップ・出力マップから消えていること。
- `character.update`: `appearances` を拒否すること。`name` / `names` /
  `voices` の部分更新が通ること。0 項目拒否。
- `thumbnail.update`: 0 項目拒否、省略した `appearanceOverride` の維持、
  `null` の解除、オブジェクトの全体置換、テンプレートのみ変更時の検証。
- `voiceProfile.update`: 0 項目拒否、省略項目の維持、`settings` の全体置換、
  `adapterId` 拒否。
- `composition.draft.update` の入出力とカタログ。
- Script Operation の名前一覧、`cue.setInput` の `replace` 拒否、
  `cue.updateInput` の受理。
- `schema.get` の `agentOperations` に旧名・`asset.update` が無いこと。
- `operationDigest` / `schemaDigest` の変化は既存のダイジェストテストで確認する。
  固定値のスナップショットがある場合は更新する。

### 6.2 Script Operation Core

- `audio.update` が部分更新であること。
- `line.updateText` が caption / speech の片方だけを更新できること。
- `cue.updateTransition` が enter / exit の片方だけを更新できること。
- `cue.setInput` が入力を全体置換すること。
- `cue.updateInput` が plain object を深くマージし、配列・`null` を置換すること。
- `standing.upsert` が:
  - 新規作成時に既定値を使う。
  - 既存時に省略値を維持する。
  - 既存時に `transition` を指定すると enter / exit をまとめて置換する。
  - 内部 Cue の ID と order を維持する。

### 6.3 API・束縛

- `apps/api/src/agent/*.test.ts`
  - `asset.update` でタグ・お気に入り・アーカイブを同時に更新できる。
  - `asset.update` が `AGENT_OPERATION_UNKNOWN` になる。
  - `character.update` が `appearances` を拒否する。
  - `character.addAppearance` / `updateAppearance` が従来どおり動く。
  - `thumbnail.update` の省略維持・`null` 解除・テンプレート変更を確認する。
  - `voiceProfile.update` の省略維持・`settings` 置換を確認する。
  - `composition.draft.update` が動く。
- `apps/mcp/src/tools.test.ts`
  - `asset.update` のツールが無い。
  - `composition.draft.update` のツール名が `kakeai_composition_draft_update`。
- `apps/cli/src/cli.test.ts`
  - 操作カタログの全件解決。
  - 旧名のサブコマンドが無い。
- `apps/web/src/content/structural/*.test.ts`
  - 新しい操作名で同じ編集結果になる。
- `apps/api/src/agent/production-flow.test.ts`
  - `standing.upsert` を含む制作フローが通る。

### 6.4 実行コマンド

```
npm run typecheck
npm test
npm run check:file-size
```

必要に応じて個別に:

```
npx vitest run packages/contracts/src/script-operation.test.ts
npx vitest run packages/contracts/src/agent-operations.test.ts
npx vitest run packages/script-edits/src
npx vitest run apps/api/src/agent
npx vitest run apps/web/src/content/structural
```

## 7. 完了条件

- [ ] `asset.update` が Agent 操作カタログ・MCP ツール・CLI サブコマンド・
      スキル・ユーザーガイドから消えている。
- [ ] `asset.update` が `tags` / `favorited` / `archived` の部分更新になり、
      `tags` 全体置換と `tags: []` の全解除がテストされている。
- [ ] `character.update` が `name` / `names` / `voices` だけを受け付け、
      `appearances` を拒否する。外観は `addAppearance` / `updateAppearance`
      だけで編集する。
- [ ] `thumbnail.update` と `voiceProfile.update` が省略＝維持になり、
      0 項目が `VALIDATION_ERROR` になる。
- [ ] `cue.setInput` が全体置換、`cue.updateInput` が深いマージになっている。
- [ ] `standing.upsert` が `standing.upsert` になり、作成・既存値維持・
      既定値の挙動がテストされている。
- [ ] `composition.draft.update` が `composition.draft.update` になっている。
- [ ] 旧操作名が、ADR 本文や公開済みリリースの互換性履歴などの歴史的記録を
      除いてリポジトリに残っていない。確認例:

      ```
      rg -n 'asset\.tag|audio\.set|line\.setText|cue\.setTransition|standing\.set|composition\.draft\.save' \
        --glob '!docs/adr/**' --glob '!**/node_modules/**'
      ```

      検出された箇所は、現在の手順なら新名へ、歴史的記録なら
      「ADR 0109 で廃止」などの注記へ置き換える。

- [ ] `npm run typecheck` と `npm test` が通る。
- [ ] `npm run check:file-size` が通る。
- [ ] `docs/agent-access/spec.md`、`docs/editor-core/spec.md`、スキル、
      ユーザーガイド、ADR 0109 と各 ADR の `Amended by` が更新されている。
- [ ] DB migration と HTTP API の契約変更がない。
- [ ] AGENTS.md のレビュー手順（`ocr review`）とコミット手順に従う。

## 8. リスクと注意点

- **`thumbnail.update` の暗黙解除が変わる**: 現行は `appearanceOverride` の
  省略で解除する。新契約では省略は維持、解除は `null`。既存の呼び出しと
  テストを必ず更新する。
- **`cue.setInput` の既定動作が変わる**: 旧 `replace` 省略時は深いマージだった。
  新 `cue.setInput` は常に全体置換なので、部分更新したい呼び出しは
  `cue.updateInput` に移す。Web UI は全体置換なので `replace` を外すだけでよい。
- **`voiceProfile.settings` の全体置換**: 部分的な settings を送ると必須項目が
  欠けて `VALIDATION_ERROR` になる。呼び出し側はアダプターの完全な設定を送る。
- **`character.update` の外観削除**: 旧契約に依存するスキル・ガイドが残ると、
  エージェントが `appearances` を送って失敗する。全ドキュメントを同時に更新する。
- **プロトコル版を上げない判断**: 旧クライアントは接続できるが、旧操作名は
  `AGENT_OPERATION_UNKNOWN`、旧フィールドは検証エラーになる。単一利用者前提を
  ADR に明記する。将来、外部利用者に配布する場合は版の扱いを再検討する。
- **ADR の本文を書き換えない**: 過去の判断は残し、新 ADR と `Amended by` で
  変更を記録する。
- **履歴文書の旧名**: `docs/agent-mp4-production/findings.md` などの過去の
  観察記録は、現在の手順と混同しないよう、現在形の指示だけを更新する。
