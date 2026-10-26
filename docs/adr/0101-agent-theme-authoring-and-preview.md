# エージェントへの Theme 作成・Draft 編集・公開と PNG プレビューの公開

Status: accepted

## 背景

Visual Theme は作品の外側にある共有ライブラリで、Theme Draft（可変）と Theme Revision（不変）を持つ。HTTP API と Web UI は、利用者 Theme の作成・組み込み Theme からの複製・Draft の保存／破棄／公開／アーカイブと、代表サンプルの HTML プレビューを既に持つ（[テーマカスタマイズ仕様](../theme-customization/spec.md)）。

Agent Access は Theme を読むことだけを公開してきた（B8 / B15）。そのためエージェントは、作品の見た目を自分で決められず、テーマが用意されていなければ人間の作成待ちで止まる。C1〜C3 でフォントカタログと過去 Revision の読み取り、フォント診断を公開したため、作成の前提は揃っている。

Theme の作成・Draft 編集・公開は、台本・Audio Take・レンダー成果物を書き換えない。Draft は可変だが公開 Revision を壊さず、公開は不変 Revision の追加である。したがって [ADR 0074](./0074-agent-direct-reversible-operations.md) の可逆操作の範囲として公開できる。一方、アーカイブは選択肢から隠す操作で、取り消し（unarchive）の API が無く、削除は実体削除である。どちらも人専用に残す。

代表サンプルのプレビューは HTTP では HTML を返す。エージェントは HTML を描画できないため、見た目の確認にならない。既存の `PreviewRasterizer` は保存版のプレビューで同じ HTML を PNG 化しており、Theme の代表サンプルにもそのまま使える。

## 決定

Theme の作成・Draft 編集・公開と、代表サンプルの PNG プレビューを公開する。`AGENT_PROTOCOL_VERSION` は `1` のまま据え置く（加算的変更）。

- `theme.create`（mutation）— HTTP と同じ `{ name, sourceThemeRef? }` を受け、`{ themeId, draft }` を返す。`sourceThemeRef` を省略すると組み込み Soft Editorial を複製元にする。新しい Theme は公開 Revision を持たないため、Draft を編集して公開する。
- `theme.draft.get`（read）— `{ themeId }` を受け、`{ draft }` を返す。Draft が無い場合と組み込み Theme は `draft: null`、未知の Theme は `RESOURCE_NOT_FOUND`。壊れた Draft は HTTP の読み取りと同じく「無い」ものとして扱う。
- `theme.draft.save`（mutation）— `{ themeId, definition }` を受け、`{ draft }` を返す。既存の `ThemeService.updateThemeDraft` の upsert をそのまま呼ぶ。公開 Revision を変えず、版も消費しない。組み込み・未知・アーカイブ済み Theme は `RESOURCE_NOT_FOUND`。
- `theme.publish`（mutation）— `{ themeId }` を受け、公開した Revision を `{ theme }` で返す。公開時に Draft は破棄される。Draft が無い場合は `INVALID_STATE`（再送で二重に公開されない）。
- `preview.theme`（read、画像）— 未保存の `{ definition, locale?, timeMs? }` を受け、代表サンプルの PNG（base64）を返す。`locale` は既定 `ja-JP`、`timeMs` は既定 4500。DB・Theme Draft・Revision・Job・Artifact を書かない。

`preview.theme` が定義そのものを受け取るのは、HTTP の代表サンプルプレビューと同じ契約にし、Draft を保存せずに反復できるようにするためである。保存済み Draft を読む専用の入力にすると、プレビューのたびに Draft を書き換えるか、Theme の解決を操作に持ち込む必要がある。エージェントは `theme.draft.get` の定義を手元で変えてプレビューし、納得した時点で `theme.draft.save` する。

`timeMs` の既定 4500 は、代表サンプルの 4 秒の導入に続く要点シーンで、見出し・本文・ラベル・字幕が同時に見える時刻である。1 枚で配色と文字 role の大半を確認できる。導入や他のシーンを見たい場合は `timeMs` を明示する。代表サンプルの尺を超える指定は `VALIDATION_ERROR` とする。

アーカイブ・削除・Draft の破棄は公開しない。アーカイブは取り消し API が無く、削除は実体削除である。Draft の破棄は `theme.draft.save` で上書きできるため、主線に不要である。

## Considered Options

- Theme の作成・公開も人専用のままにする。→ テーマが無い作品は人間の作成待ちで止まり、C1〜C3 で揃えたフォントの知識も使えない。可逆な追加操作なので公開する。
- Theme のアーカイブも公開する。→ 取り消し手段が無く、選択肢から Theme を隠す影響が読めない。人専用に残す。
- Draft の破棄を公開する。→ `theme.draft.save` で上書きでき、主線に不要。人専用に残す。
- `preview.theme` が `themeId` と `version` を受け、公開 Revision をプレビューする。→ 既存の `theme.get` で定義を読んでから渡せる。入力が 2 系統になると、未保存 Draft の確認という主目的が曖昧になる。定義入力に絞る。
- `preview.theme` が HTML を返す。→ エージェントは描画できず、視覚確認にならない。既存の PNG 生成経路を使う。
- `timeMs` の既定を 0（導入）にする。→ タイトルと背景は見えるが、本文・ラベル・字幕のスタイルを確認できない。要点シーンの 4500ms を既定にする。

## Consequences

- Agent Access 仕様の MCP 操作表・操作詳細・タイムアウト・エラー表、roadmap、todo、テーマカスタマイズ仕様、制作スキル、ユーザーガイドを更新する。`operationDigest` と `schemaDigest` は変わり、束縛（MCP / CLI）とアプリは同じビルドで揃える。
- 制作スキルは、`theme.create` → `theme.draft.get` → 定義を編集 → `theme.draft.save` → `theme.diagnose` → `preview.theme` → `theme.publish` の順を示す。公開後の Draft は消えるため、続けて編集する場合は公開 Revision の定義を元に `theme.draft.save` で新しい Draft を作る。
- `preview.theme` は代表サンプルだけを描画し、実作品への適用結果は `preview.scriptFrame` で確認する。最終的な絵の判断は人に残す。
- この決定は恒久ではない。Theme のアーカイブや削除、Draft の破棄、公開 Revision のプレビューが必要になった場合は、取り消し手段と合わせて新しい ADR で判断する。
