# エージェントへのフォントカタログ・過去 Theme Revision・フォント診断の公開

Status: accepted

## 背景

Theme の作成・編集（C4）をエージェントへ開く前提として、次の 3 つが欠けていた。

1. インストール済みフォントを探す手段がない。`Theme Definition` の `fontFace` は family・PostScript 名・weight・style を持つが、エージェントは値を推測するしかない。macOS の Font Catalog は約 2,800 face あり、全件を 1 応答で返すとエージェントのコンテキストを大きく消費する。
2. `theme.get` は最新公開 Revision しか返さない。既存の Script Version が古い Revision を参照していても、その定義を読めず、複製元にもできない。
3. `theme.get` は Font 診断を返さない。`createRenderJob` はレンダー投入時に欠落フォントを計算しているが、結果は `Job` のスナップショットに留まり、`job.get` の DTO には出ない。エージェントはレンダーが失敗するまで気づけない。

いずれも読み取りであり、正本を書き換えない。したがって [ADR 0074](./0074-agent-direct-reversible-operations.md) の可逆性の境界とは衝突しない。

## 決定

3 つを read 操作として公開する。`AGENT_PROTOCOL_VERSION` は `1` のまま据え置く（加算的変更）。

- `font.list` — `{ query?, style?, minWeight?, maxWeight?, available?, limit?, offset? }` を受け、絞り込んだ `FontFace` の 1 ページと `total`・`nextOffset`・カタログの対応状況を返す。`query` は family・表示名・PostScript 名の部分一致、`limit` は既定 50・最大 200、並び順は family → weight → style → PostScript 名で固定する。カタログの強制更新は公開しない（既存のキャッシュと UI からの更新を使う）。
- `theme.get` の `version` — 任意の `version` を受け、指定時はその公開 Revision を返す。`version` を省略したときは従来どおり `theme.list` に載る最新公開 Revision だけを返す。`theme.list` の最新限定は変えない。
- `theme.diagnose` — `{ themeId, version?, locale?, verify? }` を受け、既存の `FontCatalogService.resolveThemeFonts` の結果（role ごとの local face と `usesFallback`、`missingFonts`、`diagnostics`、カタログと検証の対応状況）を返す。`version` の解決は `theme.get` と同じ。`locale` は既定 `ja-JP`、`verify` は既定 `true`。

`version` を指定した `theme.get` は、アーカイブ済み Theme の公開 Revision も返す。既存の Script Version はその Revision を参照し続け、レンダーでも解決されるため、読めない理由がない。Theme Draft は引き続き返さず、未知の Revision は `RESOURCE_NOT_FOUND` とする。

`theme.diagnose` は Theme Revision だけを対象にする。保存済み Script Version を対象にすると入力が union になり、対象の解決（版 → Edition → Theme と locale）まで操作に含める必要がある。まずは Theme 作成の確認に必要な範囲に絞り、レンダー前の版単位診断が必要になった時点で別操作として足す。

`verify` の既定を `true` にするのは、レンダー投入時と同じ判定にするためである。macOS では Font Catalog に見えても Chromium が解決できない face があり、カタログ照合だけでは「解決できる」と誤って報告し得る。Chromium 検証は共有サービスが結果をキャッシュするが、初回はブラウザ起動を含むため、`theme.diagnose` の読み取りタイムアウトを 60 秒にする。`font.list` も初回の `system_profiler` を待つことがあるため 30 秒にする。

## Considered Options

- `font.list` が全件を返す。→ 約 2,800 face・約 1 MB になり、エージェントのコンテキストを圧迫する。不採用。
- `font.list` を family 一覧、`font.get` を family 内の face 取得に分ける。→ 応答は小さいが操作が 2 つになり、検索のたびに往復が増える。1 操作の検索＋ページングを採る。
- `theme.revision.get` を新設する。→ `theme.get` と入力・出力がほぼ同じで、エージェントが 2 つを覚える理由がない。`version` を任意に足す。
- `version` 指定でもアーカイブ済み Theme を読ませない。→ 既存作品が参照する Revision を確認できず、C2 の目的を満たさない。読めるようにする。
- `theme.diagnose` の既定を `verify: false` にする。→ カタログに見えるが Chromium で解決できない face を見逃す。既定 `true` とし、速さが必要なときだけ `false` を選ばせる。
- `theme.diagnose` が保存済み Script Version も受ける。→ 入力が union になり、版から Theme と locale を解決する責務が増える。Theme Revision に対象を絞る。

## Consequences

- Agent Access 仕様の MCP 操作表・操作詳細・タイムアウト・エラー表、roadmap、todo、制作スキル、ユーザーガイドを更新する。`operationDigest` と `schemaDigest` は変わり、束縛（MCP / CLI）とアプリは同じビルドで揃える。
- エージェントは `theme.get` で既存作品の Theme Revision を読み、それを複製元にして `theme.create`（C4）へ進める。C4 の着手時に、テーマの視覚確認方法（`preview.theme` か公開後の `preview.scriptFrame` か）を別途決める。
- `font.list` はカタログのキャッシュを読む。アプリ起動後に OS へフォントを追加した場合、UI からカタログを更新するまで見えない。エージェント向けの強制更新は、必要になった時点で別操作として検討する。
- `theme.diagnose` は Theme Revision の診断であり、保存済み Script Version のレンダー前診断ではない。後者が必要になった場合は、版から Theme と locale を解決する read を別に追加する。
