# 多言語Edition の作成と翻訳接続の仕様

## 目的と境界

この文書は、日本語版（既存の `LanguageEdition`）を元に、英語などの他言語の版（第2の `LanguageEdition`）を作成し、外部エージェントによる翻訳を取り込めるようにする機能の正を定める。台本の正本JSON契約は [../mvp/content-schema.md](../mvp/content-schema.md)、破壊変更履歴は [../mvp/content-schema-history.md](../mvp/content-schema-history.md)、HTTP契約は [../mvp/api-contract.md](../mvp/api-contract.md)、DBモデルと Job 状態遷移は [../mvp/spec.md](../mvp/spec.md)、Agent Access は [../agent-access/spec.md](../agent-access/spec.md)、声と言語の結びは [../multilingual-voice/spec.md](../multilingual-voice/spec.md) を正とし、この文書はそれらへの追加を定める。

- 第2言語版は、既存 Work への `LanguageEdition` 追加として作る（[ADR-0081](../adr/0081-language-edition-added-to-existing-work.md)）。Work を複製して別言語Workにする形は採らない。
- Edition の初期版は、指定した元 Edition の current `ScriptVersion.contentJson` をそのままコピーして作る。Scene・VisualCue・素材参照・キャラクターはそのまま引き継ぐ。
- Edition 間の同期表示・自動同期・未同期リストは作らない（[ADR-0082](../adr/0082-no-edition-sync-tracking.md)）。作成後の Edition は、原語の台本構造を受け継いだ別物として編集する。言語版間の行対応は `line` と Scene の stable ID（[../mvp/content-schema.md](../mvp/content-schema.md)）で辿れる前提のみ維持する。
- 翻訳はアプリ内部の翻訳 Job にしない。外部エージェントが元 Edition の contentJson を読み、翻訳した contentJson を対象 Edition に候補 `ScriptVersion` として保存し、人が承認（current 進行）して確定する。手動でも同じ経路（Web UI の編集保存）で作れる。

## Edition 作成

`POST /works/:workId/language-editions` を追加する。

- リクエストは `locale` と、シード元を指す `sourceEditionId` を持つ。`locale` は `localeSchema`（`ja-JP` / `en-US` / `zh-Hans` / `zh-Hant`）で検証し、当該 Work に既に存在する locale は 409 `LANGUAGE_EDITION_EXISTS` で拒否する。シード元が他 Work の Edition の場合は 404 `RESOURCE_NOT_FOUND` とする。
- 同一トランザクションで Edition を作り、初期 `ScriptVersion` v1 を作成して `currentScriptVersionId` を設定する（[../mvp/spec.md](../mvp/spec.md) の作成規則に従う）。
- 初期版の contentJson は、シード元 current 版を深いコピーして初期化する。ただし次を置き換える：
  - `document.locale` を作成先の locale に変える。
  - 話者の `voiceProfileId` は全て null にする。シード元の声は原語の声であり、target locale では TTS 未設定として扱う（[../multilingual-voice/spec.md](../multilingual-voice/spec.md) の解決規則）。話者自身とキャラクターの `voices`（対応表）はコピーして維持する。
  - 各 Character の `names`（対応表）はコピーして維持し、`Character.name` と対応する `Speaker.name`（`characterId` が一致する話者）は作成先 locale の別名に置き換える。一致する別名がなければ既定の `name` のまま残す。`characterId` を持たない話者の名前は変えない（[ADR 0091](../adr/0091-character-locale-names.md)）。
  - `selectedAudioTakeId` は全て null にし、`audioTakes` は空配列にする。原語の音声は翻訳版へ引き継がない（字幕のみで開始する）。
  - `sourceScriptVersionId` にシード元 ScriptVersion を記録する（復元・翻訳・下書きの系統を示す既存フィールド）。
  - 初期版の `author` は `human` とする（システムによるコピー操作）。
- レスポンスは作成した Edition と初期版を、既存の Edition DTO の形に従って返す。

## 言語版の切替と編集

- 編集画面は `WorkEditPage` が `languageEditions[0]` を無条件に使っているのを解消し、Edition を選んで切替できるようにする。URL は既存の `/works/:workId/editions/:editionId/...` を維持する。
- Edition 追加は Work の編集画面（または作品一覧の操作）から、locale とシード元 Edition を選んで行う。
- 編集・保存・復元・プレビュー・レンダーは既存の Edition スコープの機能をそのまま使う。Edition 間で Edition データの共有（locale 中立なもの）を増やさない。キャラクターライブラリはアプリ共通のままとする。

## 翻訳の接続（外部エージェント）

- Agent Access に `edition.create` 操作を追加する（`work.create` と同じ系統の mutation）。引数は HTTP と同じ（`workId`、`locale`、`sourceEditionId`）。エージェントはこれで翻訳先 Edition を作れる。
- 既存の `script.save` に検証は追加しない：`saveScriptVersion` が既に `ContentDocument.locale` と対象 Edition の `locale` の一致を必須とし、不一致は 422 `VALIDATION_ERROR`（`details.issues` の path `["content","locale"]`）で返す。エージェント束縛では同じ内容が `VALIDATION_ERROR` として返る。専用の `EDITION_LOCALE_MISMATCH` コードは設けない（既存の locale 不一致の扱いと統一する）。
- 翻訳の下流（元 Edition の読み取り・翻訳の生成・対象 Edition への `script.save`）はエージェント側の責務とし、アプリは読み取りと検証だけを提供する。`skills/kakeai-production/` に翻訳版制作の手順（「元 Edition を `script.get` で読み、`edition.create` で訳edition を作り、翻訳 contentJson を `script.save` する」）を追加する。
- 翻訳版は人が確認して current として承認する。承認を追加UIにする必要はなく、Web UI での版の選択（current 進行）をそのまま使う。

## レンダーの locale 対応

- Composition コンパイラは、数値・通貨のフォーマットを document の locale に従わせる。現在 `ja-JP` 固定の `Intl.NumberFormat` と JPY 固定を外し、locale から導出する（`ja-JP` → JPY、`en-US` → USD、`zh-Hans` → CNY、`zh-Hant` → TWD）。
- フォントは現在同じテーマフォントを扱う。`en-US` で日本語フォントに含まれる英字で描画できる前提とし、言語別フォント診断・テーマ別フォントは対象外とする（課題が残るようなら将来フォルダを切る）。

## 対象外

- アプリ内翻訳 Job・アプリ内翻訳 UI
- Edition 間の同期表示・未同期検知・再翻訳リスト
- locale 別のテキスト上限・読速チェック（[ADR-0090](../adr/0090-text-overflow-estimate-by-character-width.md) の文字幅推定で対応済み。locale による基準の切り替えは行わない）
- 素材の言語自動差し替え（`Asset.language`）。素材は当面素材タグで扱う。
- `en-US` 以外の locale 追加（`localeSchema` に足すだけで追加可能な実装にしておく。2026-10 に `zh-Hans` / `zh-Hant` を追加済み。通貨は `currencyForLocale` が locale から導出する）

## 完了条件

既存の ja-only 作品の動作が変わらないことを保ちながら、日本語原本の作品から英語版をエージェント翻訳で作り、人が承認して、英語の音声を選べば、MP4 をレンダーできる。具体的には：

- 既存 ja 作品で edition 作成・編集・レンダーの流れが破綻しない
- en-US Edition を作成し、エージェント（MCP/CLI）の `edition.create` → `script.save`（翻訳 contentJson）→ current 進行が通る
- 英語の声（locale 別割り当て、`openai-compatible`）で TTS が回る
- 字幕SRTの言語版出力が効く（既存機能）
- レンダーした MP4 の数値・通貨が `en-US` で描画される

## テストの方針

- 文言・UI表現はテストしない。Edition 作成のシードコピーの置き換え規則（locale・voiceProfileId・audioTakes・sourceScriptVersionId）と locale 重複拒否、`script.save` の locale 一致検証の境界をテストする。
- フェーズをまたぐ動作確認（typecheck・vitest）は既存の手順に従う。
