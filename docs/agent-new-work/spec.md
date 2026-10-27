# エージェント新規作成の信頼性向上 仕様

## 目的

新規`work.create`からレンダー投入までのエージェント完走率を上げる。エージェントは下書き・配置まで、確定と品質判断は人が行う。単一ライター（人とエージェントの同時編集なし）を前提とする。感想報告・視覚品質判断は対象外。

## 境界

- 正は本フォルダの3文書とする。既存の正（`docs/agent-access/spec.md`、台本編集は`docs/editor-core/spec.md`、HTTPは`docs/mvp/api-contract.md`、台本構造は`docs/mvp/content-schema.md`）と矛盾しない。矛盾時は本フォルダではなく既存正を優先し、本フォルダを直す。
- 破壊的契約変更は行わない。`AGENT_PROTOCOL_VERSION`据え置き、`operationDigest`/`schemaDigest`の意味変更なし。やることは運用・技能・文書・テストと、非破壊の小改善に限定する。
- 不可逆操作の開放は行わない。削除系・外部公開・Voice/FaceSet/Adapter設定変更・利用者が設定していない接続先での生成は人専用（`docs/agent-access/spec.md`の可逆/不可逆境界を維持）。

## 対象フロー（新規完走の主線）

`schema.get` → `work.create` → `script.get` → `character.addFromLibrary`（コピー呼と割当呼の2呼） → `asset.list/import/wait/get` → `script.edit`（cue/audio/standing） → `tts.createBulk(requestId付)` → `tts.attachBulk` → `script.validate` → `render.start` → `job.wait/get`

## A. 止まりにくさ（主）

- `tts.createBulk`は必ず`requestId`付で開始する（なし開始は永久に確定不可、`docs/agent-access/spec.md`のTTS契約）。
- `tts.createBulk`→`tts.attachBulk`間は台本を書き換えない（書換えは`SCRIPT_BASE_STALE`で無添付停止）。
- `character.addFromLibrary`は`key`を持たないため、1呼目コピー・2呼目`line.setSpeaker`/`standing.upsert`に分ける（`docs/agent-access/spec.md`のCharacter契約）。
- タイムアウト後は状態確認先行。`script.edit`/`tts.attachBulk`のみ同`requestId`即再送可、その他変更は`script.get`/`job.list`/`asset.list`/`composition.get`で確認後に再実行（`skills/kakeai-production/SKILL.md` 9章）。
- `job.wait`の`timedOut:true`は失敗ではない。同Job IDで継続待機する。
- `agentId`は必ず送る（MCP/CLI既定を利用）。未送出は台帳`none`枠共有で衝突余地（`docs/agent-access/spec.md`冪等台帳）。

## B. 検証前倒し（従）

- TTS前・レンダー前に`script.validate`を挟む。`{ baseScriptVersionId, operations }`のdry-runで次編集を保存なし検証できる（`docs/agent-access/spec.md`操作一覧）。
- `asset.get`で`status:ready`を確認してから参照する。未readyは`ASSET_UNAVAILABLE`。
- `composition.publish`は`dryRun:true`先行。`STYLE_KIT_MODIFIED`・`VALIDATION_ERROR`を本publish前に出す。
- `faceSetId`/`expressionId`・landscape限定・insert制約は保存時解決のため、TTS/レンダー投入の直前ではなく編集直後に`validate`で出す。

## 非目標

- 版履歴一覧・Artifact列挙・素材バイト直読・サムネイル/Theme/FaceSet/Voice管理の開放（人確定が残るうちは後回し）。
- `preview.frame`強化・感想報告の自動化。
- 削除系・外部公開・同時編集対応。

## 関連

MP4出力に限定した継続計画（人間が最終確認・サムネイル・字幕・YouTube設定を行う前提）は
[エージェントMP4制作](../agent-mp4-production/spec.md) を参照する。
