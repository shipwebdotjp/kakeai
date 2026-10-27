# Agent 操作の set/update 命名統一

Status: accepted

## 背景

Agent Access と Script Operation の操作名・更新意味を「`set` = 名前で示した値の全置換 / `update` = 部分更新」に揃える。旧クライアントとの互換性は保証しない。`AGENT_PROTOCOL_VERSION` は据え置く。

## 決定

- `set` は名前で示した値の全置換、`update` は部分更新、`upsert` は作成または部分更新、`save` は文書全体の保存。
- `asset.tag` を `asset.update` に統合し、`asset.setTags` は作らない。
- `character.update` から `appearances` を外し、`addAppearance` / `updateAppearance` に寄せる。
- `thumbnail.update` / `voiceProfile.update` を部分更新にする。
- `composition.draft.save` を `composition.draft.update` に改名する。
- Script Operation の改名: `audio.set` → `audio.update`、`line.setText` → `line.updateText`、`cue.setTransition` → `cue.updateTransition`、`standing.set` → `standing.upsert`。
- `cue.setInput` は常に全体置換、`cue.updateInput` を新設して深いマージを担う。
- `cue.setInput` の `replace` フラグを削除する。

## Considered Options

- 旧名の別名を残す、プロトコル版を上げる、`asset.tag` を残す、`character.update` の配列置換を残す、`cue.setInput` の `replace` フラグを残す。

## Consequences

- `operationDigest` / `schemaDigest` が変わる。DB migration と HTTP API の変更はない。
- スキル・ユーザーガイドを同時に更新する。
