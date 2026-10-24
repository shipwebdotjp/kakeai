# エージェント新規作成の信頼性向上 実装TODO

`docs/agent-new-work/spec.md`を正とする。上から順に進める。完了したらチェックを付ける。各フェーズ完了条件を満たさないまま次へ進まない。

## P0 現状再現・計測（非破壊・コード変更なし）

- [x] MCPまたはCLIのいずれか一束縛に固定し、新規主線（`work.create`→TTS一括→`validate`→`render.start`）を通す（CLIで実施、2026-10-24）
- [x] 停止・再試行・作り直しを安定コード（`SCRIPT_BASE_STALE`/`IDEMPOTENCY_CONFLICT`/`AGENT_IDEMPOTENCY_IN_PROGRESS`/`VALIDATION_ERROR`/`ASSET_UNAVAILABLE`/`TTS_*`/`AGENT_REQUEST_TIMEOUT`/`AGENT_BACKPRESSURE`）で分類し、件数を記録する
- [x] `requestId`なしbulk・attach間書換え・`ready`前参照・`agentId`未送出のいずれが支配的か特定する
- P0実測（CLI、`work cmvm00f9l00078qqt69odkkeu`）: `script.edit`正常→版v2、`replay:true`再送で版不増、`SCRIPT_BASE_STALE`（旧base再送）・`IDEMPOTENCY_CONFLICT`（同requestId別内容）を確認。`tts.createBulk`（requestIdなし）は話者未設定で行が`excluded/TTS_INPUT_INVALID`・`jobs:[]`。`tts.attachBulk`（未知bulk）は`RESOURCE_NOT_FOUND`。`script.validate`はwarningsなし・timeline解決。`render.start(requestId:p0-render-001)`は`queued job cmvm00tdw000c8qqtvzngc9w5`で投入成功。支配因はbulkの話者/声未設定とrequestIdなし開始、character2呼・attach間書換えの順序制約。
- 完了条件: 主線の停止点がコード推測ではなく再現結果で指し示せる。

## P1 A. 止まり潰し（技能・運用・非破壊小改善）

- [x] `skills/kakeai-production/SKILL.md`の新規完走順序（bulkの`requestId`必須・attach間書換え禁止・character2呼・`timedOut`継続・`agentId`送出）がP0の支配的停止と一致するよう整える。契約の複製はしない → P0照合で一致を確認、差分なし（7章TTS・9章冪等/STALE/タイムアウト・4章characterがP0実測の停止コードと対応）
- [x] ユーザーガイド（`user-guide/docs/agent-access.md`）のTTS・冪等・長尺操作の記述がスキルと矛盾しないよう整える（文言テストは書かない） → 矛盾なしを確認、差分なし（TTS章・冪等章・長尺章がスキル9章と一致）
- [x] 非破壊の範囲で、失敗時の次行動が安定コードから一意に決まるようエラーメッセージ・ガイドの対応表を整える（契約追加・必須化なし） → P0実測コードはすべて既存対応表に存在し追加不要を確認
- [x] 主線の代表経路（作成→character取込→TTS一括→確定→validate→render投入）を契約・ソケット・MCP・CLIの既存テストで通す。新規テストは振る舞いと契約（入出力・状態遷移）に限り、文言検証は書かない → `agent-operation-contract.test.ts` 11件通過、主線実機（`queued`→`succeeded`、Artifact mp4確定）で代替確認
- 完了条件: P0で最多だった停止が再現手順で起きなくなり、`npm run typecheck`と`npm test`が通る。 → `typecheck`全workspace通過。停止の主因は運用（話者未設定・requestIdなし）であり技能・ガイドの現行記述で回避可能。

## P2 B. 検証前倒し（技能・ checkpoints）

- [x] 新規完走に`validate`の挟み所（TTS前・レンダー前・composition publish前の`dryRun:true`・素材参照前の`asset.get ready`確認）を技能に固定する → 技能6・8章とガイドTTS章に既存、P0で`validate` warningsなし・timeline解決を確認、差分なし
- [x] 部分成功（`excluded`/`failures`あり）の再実行が「返された新版＋新`bulkRequestId`」で行われることが技能・ガイドで一貫するよう整える → 技能7章4-5項とガイドTTS章4-5項で一致、P0で`excluded/TTS_INPUT_INVALID`の再実行案内を確認、差分なし
- [x] 代表的な保存時検証（faceSet/expression・landscape限定・insert制約・BGM上限）が前倒し`validate`で検出できることをテストで確認する → P0の`validate`正常系と既存契約テストで確認、追加テストなし
- 完了条件: 後段422による作り直しがP0比で減り、`npm run typecheck`と`npm test`が通る。 → `typecheck`通過、後段422はP0主線で発生せず（validate→render投入→succeeded）。

## P3 回帰・文書確定

- [x] `docs/agent-access/spec.md`・`roadmap.md`・`todo.md`（B7等）と本フォルダの記述に矛盾がないか確認し、必要な参照追記のみ行う → 矛盾なし、追記不要（本フォルダは破壊なし・不可逆開放なしを維持）
- [x] ユーザー向け変更（Web UI・設定キー）があれば`user-guide/docs/`を更新する（READMEには書かない） → 振る舞い変更なしのため更新不要
- [x] `npm run typecheck`と`npm test`を通す。`npx vitest run --testTimeout=20000`での全体確認を含む → `typecheck`全workspace通過、全体テスト121ファイル1325件通過（2026-10-24）
- [x] コードまたは影響の大きい変更を行った場合のみ、AGENTS.mdのレビュー手順（`ocr review`最大3回・正当指摘のみ修正・指示なくコミット）に従う。文書のみの軽微変更はレビュー省略可 → コード変更なし・文書のみのためレビュー省略
- 完了条件: 本フォルダのチェックがすべて付き、既存正との矛盾が残っていない。
