# Agent Experience 仕様

## 目的と境界

この文書は、外部 Agent が保存済み台本を確認・引き継ぎ・復旧するときの
Agent Access 拡張を定める。対象は、行を基準にした台本プレビュー、
handshake のプロトコル不一致診断、二つの Script Version の構造差分である。

- Agent Access 全体の境界、MCP と CLI の束縛、操作カタログは
  [../agent-access/spec.md](../agent-access/spec.md) を正とする。
- `ContentDocument`、Script Version、Scene、Narration Segment、Visual Cue の正本は
  [../mvp/content-schema.md](../mvp/content-schema.md) と
  [../mvp/spec.md](../mvp/spec.md) を正とする。
- `script.edit` の `created` は、操作を実行した時点の結果であり、この機能では
  永続化・再構成しない。`script.diff` の `added` は `created` の代替ではない。
- HTTP API、Web UI の編集意味論、Script Version の保存スキーマは変更しない。
- 追加する Agent 操作は既存の local socket、MCP、CLI で同じ契約を使う。

## 用語

- **Line-addressed Script Preview**: 保存済み Script Version の Narration Segment を
  `lineId` と行内オフセットで指定して得る Script Preview Frame。
- **Script Difference**: 同一 Language Edition に属する二つの保存済み Script Version を、
  要素 ID によって構造比較した読み取り結果。編集操作の履歴や意味的な差分ではない。

## 変わらない原則

- すべてのプレビューと差分は read operation であり、Script Version、Job、Artifact、
  Asset を作成・更新しない。
- 操作スキーマの追加は `operationDigest` と `schemaDigest` を変える。
  任意入力・出力と新規 read operation の追加だけであるため、
  `AGENT_PROTOCOL_VERSION` は上げない。
- `script.diff` と `preview.scriptFrame` の結果は、指定された保存版から解決する。
  current Script Version を暗黙に使わない。

## 行を基準にした `preview.scriptFrame`

既存の絶対時刻入力は維持する。保存済み版についてだけ、次の入力形式を追加する。

```jsonc
{
  "scriptVersionId": "scr_123",
  "lineId": "line_456",
  "offsetMs": 500
}
```

- `scriptVersionId` と `timeMs` による既存形式、および未保存の
  `{ content, languageEditionId?, timeMs }` 形式は維持する。
- `lineId` 形式は保存済み版だけに許可する。未保存 `content` では `timeMs` を使う。
- `timeMs` と `lineId` は同時に指定できない。
- `offsetMs` は省略時 `0` とし、解決済みの対象行について
  `0 <= offsetMs <= durationMs` の整数とする。終端値は行の終端を表す。
- `lineId` は指定した Script Version の解決済み timeline に存在しなければならない。
  存在しない ID、または行尺外の offset は `VALIDATION_ERROR` とし、issue path は
  それぞれ `lineId`、`offsetMs` とする。
- 成功時は既存の `requestedTimeMs` を解決済み絶対時刻として返す。行指定形式では
  `resolvedLineId` と `resolvedTimeMs` も返す。絶対時刻形式では両フィールドを返さない。
- フレームのラスタライズ、範囲検証、出力サイズ、read timeout は既存の
  `preview.scriptFrame` と同じである。

## `AGENT_PROTOCOL_MISMATCH` の handshake 診断

プロトコル不一致のうち、正常に解析できた handshake の `protocolVersion` がサーバーの
対応範囲外である場合だけ、既存 `issues` に診断を含める。

```jsonc
{
  "code": "AGENT_PROTOCOL_MISMATCH",
  "issues": [
    {
      "path": ["protocolVersion"],
      "code": "unsupported_protocol_version",
      "message": "The resident Kakeai app accepts protocol versions 2 through 2; this client sent 1. Update the Kakeai app and its MCP or CLI binding to compatible releases, then restart the MCP host or CLI process."
    }
  ]
}
```

- メッセージは、サーバーが受け入れる protocol version 範囲、受信した版、
  アプリと MCP/CLI binding を互換な release に揃えプロセスを再起動するという包括的な
  復旧方針を示す。特定の更新コマンドや package version は示さない。
- 配布 release version は現在の handshake 契約からは判断できないため、
  protocol version を client の必要互換性として示す。実在しない release version を
  推測して案内しない。
- JSON 不正、handshake の形が不正、handshake 後の不正フレームは、従来どおり
  `AGENT_PROTOCOL_MISMATCH` だけを返す。これらを版不一致として案内しない。
- `@kakeai/agent-client` は、handshake に対応する空の request ID を持つこのエラーを
  通常の要求 ID 不一致として捨てず、`AgentClientError.issues` として MCP/CLI へ渡す。
  MCP と CLI は既存のエラー透過経路で同じ診断を返す。
- `issues` は既存エラー契約の任意フィールドであるため、プロトコル版は上げない。

## `script.diff`

`script.diff` は二つの保存済み Script Version の構造差分を返す新しい read operation である。

```jsonc
{
  "fromScriptVersionId": "scr_100",
  "toScriptVersionId": "scr_101"
}
```

### 比較の境界

- 二つの版は同じ Language Edition に属さなければならない。版が存在しない場合は既存の
  Script Version 読み取りと同じ not-found エラー、Edition が異なる場合は
  `VALIDATION_ERROR` とする。
- 比較は要素 ID を同一性の根拠とする。テキストや見た目が似た別 ID を同一要素と推定しない。
- 対象は Scene、Narration Segment（line）、Visual Cue の三種類に限る。
  Audio Cue、Speaker、Character、Theme、文書設定などの詳細な差分は初版の対象外である。
- 対象外の文書トップレベル要素に変更があれば、結果の `outsideScopeChangedFields` に
  トップレベルのフィールド名を列挙する。結果が空であっても、比較対象に変化がなかったと
  誤認させないためである。

### 差分の分類

各種類の結果は `added`、`removed`、`updated`、`moved` を持つ。

- `added`: 比較元に ID がなく、比較先にある要素。
- `removed`: 比較元に ID があり、比較先にない要素。
- `updated`: 同一 ID の内容が変わった要素。結果は `changedFields`（安定したトップレベル
  フィールド名）だけを返し、変更前後の値やテキスト全文は返さない。
- `moved`: 同一 ID の親 Scene または配列上の index が変わった要素。移動と内容変更は
  排他的ではなく、同じ ID が `moved` と `updated` の両方に現れ得る。

Scene の移動は index だけで表す。line と cue の移動は `fromSceneId`、`toSceneId`、
`fromIndex`、`toIndex` を返す。Scene の追加・削除では、その子 line/cue を重複して
`added` / `removed` に列挙しない。Scene の要約に line と cue の件数を含め、子要素の
追加・削除は両端に存在する Scene の間で起きたものだけを返す。

出力には比較した二つの Script Version の summary と、次の最小の要約を含める。

```jsonc
{
  "fromScriptVersion": { "id": "scr_100", "versionNumber": 4 },
  "toScriptVersion": { "id": "scr_101", "versionNumber": 5 },
  "scenes": {
    "added": [{ "id": "scene_new", "index": 2, "lineCount": 1, "cueCount": 2 }],
    "removed": [],
    "updated": [{ "id": "scene_1", "changedFields": ["label"] }],
    "moved": [{ "id": "scene_2", "fromIndex": 2, "toIndex": 1 }]
  },
  "lines": {
    "added": [],
    "removed": [],
    "updated": [{ "id": "line_1", "sceneId": "scene_1", "changedFields": ["captionText"] }],
    "moved": []
  },
  "cues": {
    "added": [],
    "removed": [],
    "updated": [],
    "moved": []
  },
  "outsideScopeChangedFields": ["speakers"]
}
```

- `changedFields` は位置と親を含めない。位置・親の差は `moved` にのみ表す。
- `script.diff` は操作履歴、誰が何を意図して編集したか、あるいは JSON Patch を返さない。
  詳細な値が必要な呼出側は `script.get` で版を読む。
- `script.diff` の `added` は最終状態で観測できる構造差分であり、`script.edit.created`、
  replay 時の作成 ID、または一呼出内で一時的に作成された ID を表さない。

## 互換性と文書

- 新しい `script.diff` は operation catalog から MCP tool と CLI subcommand を導出する。
  MCP 名は `kakeai_script_diff`、CLI 名は `script.diff` である。
- `preview.scriptFrame` の行指定と `script.diff` は、MCP/CLI/ソケットの同一の Zod 契約から
  生成・検証する。束縛に独自の入力解決や差分ロジックを置かない。
- 実装時は Agent Access 仕様、[../../user-guide/docs/agent-access.md](../../user-guide/docs/agent-access.md)、
  操作カタログと schema digest を同じ変更で更新する。
- `created` の永続化または再構成、diff の対象拡張、別 Edition 比較、変更前後の値や
  テキスト差分の公開は、この計画の完了条件に含めない。
