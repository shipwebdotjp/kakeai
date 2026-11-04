# Agent Experience TODO

## E1 行基準 Script Preview

- [x] `preview.scriptFrame` の保存済み版入力に `{ scriptVersionId, lineId, offsetMs? }` を追加し、既存の絶対時刻入力および下書き入力と排他的に検証する。
- [x] 保存済み Script Version の解決済み timeline から line の開始時刻と尺を求め、`offsetMs` を絶対時刻へ解決する。line 不在と範囲外 offset は `VALIDATION_ERROR` と issue path で返す。
- [x] 行指定時だけ `resolvedLineId` と `resolvedTimeMs` を返し、既存 `requestedTimeMs` は解決後の絶対時刻にする。
- [x] contracts、preview service、socket、MCP、CLI の契約テストで、開始・途中・終端、存在しない line、範囲外 offset、絶対時刻入力と下書き入力の後方互換性を確認する。
- [x] Agent Access 仕様とユーザーガイドのプレビュー説明を更新する。
- [x] 完了条件: line 分割または尺変更後でも、Agent が lineId と offsetMs だけで意図した保存版フレームを得られる。

## E2 handshake の protocol mismatch 診断

- [x] protocol version 範囲外の有効な handshake だけに、`protocolVersion` を path とする `unsupported_protocol_version` issue を返す。
- [x] issue message に受信版、サーバーの最小・最大対応版、アプリと MCP/CLI binding を互換な release に揃えてプロセスを再起動するという包括的な復旧方針を含める。
- [x] malformed JSON、不正な handshake、不正な要求 envelope は詳細な更新案内を出さない。
- [x] agent client が handshake の空 request ID の失敗応答を受け、issue を保持した `AgentClientError` として MCP/CLI へ返すようにする。
- [x] socket、agent client、MCP、CLI のテストで、下限未満・上限超過・正常範囲・不正フレームを区別する。
- [x] Agent Access 仕様とユーザーガイドのエラー説明を更新する。
- [x] 完了条件: 版ずれの利用者は、エラー出力だけから互換な binding と常駐アプリへ揃え直すべきことを理解でき、不正フレームは同じ案内を受けない。

## E3 `script.diff`

- [x] 同一 Language Edition の二つの保存済み Script Version を入力に取る `script.diff` の Zod 入出力契約を追加し、operation catalog、MCP、CLI に公開する。
- [x] Scene、line、cue を ID で比較し、`added`、`removed`、`updated`、`moved` を仕様どおりに算出する。追加・削除された Scene の子は重複報告しない。
- [x] `updated` は安定したトップレベル `changedFields` のみを返し、値・全文・JSON Patch は返さない。位置・親の変更は `moved` のみで表す。
- [x] 初版の対象外のトップレベル変更を `outsideScopeChangedFields` で通知する。
- [x] 存在しない版、別 Edition、同一版、Scene の追加・削除・並び替え、line/cue の内容変更・Scene 間移動、対象外変更を契約・サービス・socket・MCP・CLI テストで確認する。
- [x] Agent Access 仕様、ユーザーガイド、制作スキルの引き継ぎ手順を更新する。
- [x] 完了条件: Agent は `script.diff` のみで再読込すべき構造変化を絞り込み、必要な詳細だけを `script.get` で取得できる。

## E4 横断確認

- [x] `operationDigest` と `schemaDigest` が E1/E3 の契約変更で更新され、`AGENT_PROTOCOL_VERSION` は変わらないことを確認する。
- [x] docs のリンク、MCP tool 名、CLI 名、エラー説明を相互確認する。
- [x] 各コード変更サイクルで `npm run typecheck`、`npm test`、最大3回の OCR review を行い、妥当な指摘を修正してコミットする。
- [x] 完了条件: 操作の入出力・エラー・ユーザーガイド・制作スキルが同じ契約を示し、`created` の再構成を約束していない。
