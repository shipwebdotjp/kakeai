# AGENTS.md

Kakeai は、編集意図（正本JSON）をレンダー済みメディアから分離して保持する、個人用ローカル動画制作アプリ。macOS上で単一プロセス起動するWebアプリで、日本語の解説動画をMP4出力する。AI機能はネットワークや外部サービスを使える。

## 正となる文書

実装の判断は次の文書を正とする。矛盾を見つけたらコードより文書を優先し、必要なら文書とADRを更新する。

- [docs/mvp/spec.md](docs/mvp/spec.md): 全体仕様・DBスキーマ・Job状態遷移
- [docs/mvp/content-schema.md](docs/mvp/content-schema.md): 台本の正本JSON契約
- [docs/mvp/content-schema-history.md](docs/mvp/content-schema-history.md): 正本JSONの破壊変更履歴
- [docs/mvp/api-contract.md](docs/mvp/api-contract.md): HTTP API契約・DTO・エラー
- [docs/mvp/todo.md](docs/mvp/todo.md): 実装フェーズ
- [docs/adr/](docs/adr/): 決定記録。反転させる場合は新ADRを追加し、旧ADRに `superseded by` / `amended by` を付ける
- [CONTEXT.md](CONTEXT.md): 用語集（実装詳細は書かない）

## docs の運用

- 複数フェーズへの分割が必要な大きな変更を伴う新機能は `docs/<feature>/` を切り、その中に `spec.md` と `todo.md`と`roadmap.md` を置いて開発する。実装の判断はそのフォルダの文書を正とする。既存のMVPは [docs/mvp/](docs/mvp/)。
- 用語は [CONTEXT.md](CONTEXT.md) に集約する。実装詳細は書かない。
- ADRは `docs/adr/NNNN-slug.md` に **1決定=1ファイル** で追加する。番号は既存の最大+1。
- ADRは重大で後戻りコストの大きい決定だけ記録する。細かな実装選択や簡単に戻せる決定はADRにしない。
- ADRは未来永劫不変の恒久決定ではなく、その時点での判断にすぎない。前提の変化、ニーズの再検討、方向性の転換があれば、遠慮なく訂正・反転してよい。反転・変更する場合は新ADRを追加し、旧ADRに `superseded by` / `amended by` を付ける（既存ADR本文は書き換えない）。

## コマンド

```
npm install        # 依存のインストール
npm run typecheck  # 全ワークスペースの型検査
npm test           # vitest（{packages,apps}/*/src/**/*.test.ts）
```

変更後は必ず `npm run typecheck` と `npm test` を通す。

## 構成

- `packages/contracts`: Zodスキーマと型の唯一の定義場所。API・フォーム・復元・検証・編集操作はここから導出した型だけを使う。
- `packages/script-edits`: 台本編集の共有操作コア。Web UI・API・エージェント束縛は同じ操作を呼ぶ。
- `packages/video`: Compositionコンパイラと信頼済みVisualTemplate（P4で追加）。
- `apps/api`: Express + Prisma。workerループを内蔵し、単一プロセスで起動する（P1以降）。
- `apps/mcp`: MCP stdio サーバー。`@kakeai/agent-client` でローカル制御ソケットへ接続する薄い束縛。
- `apps/cli`: CLI（`kakeai-agent`）。操作名をサブコマンドとして公開し、MCP と同じ `@kakeai/agent-client` でソケットへ接続する薄い束縛。
- `apps/web`: Vite + React + TypeScript + Tailwind CSS（P2以降）。



## テスト

- 必要最低限にする。振る舞いと契約（入出力・スキーマ・境界）をテストする。
- プロンプト・メッセージ・UI文言を検証するテストは書かない。文言は頻繁に変わり、false failureを生むため。

## 作業の進め方

- [docs/mvp/todo.md](docs/mvp/todo.md) のフェーズ順に進め、完了したらチェックを付ける。
- 仕様・契約を変えたら、対応する文書とADRを同じ変更で更新する。

## レビューとコミット

コードの実装や影響の大きい変更では、次の流れを1サイクルとして行う。

1. `ocr review --audience agent -b "<変更の背景>" > /tmp/ocr_review.txt 2>&1` でレビューし、指摘を確認する。`ocr review` は6分以上かかることがあるため、タイムアウトは10分以上に取る（短いと応答なしのまま打ち切りになる）。
2. 正当な指摘のみを修正する。
3. 再度レビューして修正する。ocrレビューは最大3回までで打ち切る。
4. 打ち切り・指摘0、いずれの場合でも指示がなくてもコミットを行なう。

- 文書のみの軽微な変更はレビューを省略してよい。
- コミットメッセージは変更の意図を簡潔に書く。
- 複数回失敗したテスト操作や、コーディングミスで、回避策や対策が明らかなものについては、以降同じ轍を踏まないよう、AGENTS.mdの「## コーディングおよびテスト実行時注意事項」セクションに記載すること。

## コーディングおよびテスト実行時注意事項

- zshでは `===` や `--include=*.ts` のような未クォートの `=`・globを含む引数が展開・エラーになる（`zsh:1: == not found`、`no matches found`）。bashツールでは該当箇所をシングルクォートで囲うか、`rg --glob`・専用ツール（Grep/Glob）を使う。
- 生成Prismaクライアントが古いと `npm run typecheck` が `src/generated` 由来の存在しないプロパティで失敗する。`npm run db:generate --workspace @kakeai/api` で再生成する。
- PNG の IHDR チャンクは先頭 8 バイト署名の後に length（オフセット 8、値は 13）、type `"IHDR"`（オフセット 12）、width（オフセット 16）、height（オフセット 20）の順で並ぶ。オフセット 12 を length と誤読するとパースが壊れる。
- `system_profiler SPFontsDataType` はこの環境で約12秒かかる。`createRenderJob` は `FontCatalogService.diagnoseTheme` を呼ぶため、テストでは必ず `FakeFontCatalogAdapter` を注入する（`render-flow.test.ts`・`composition-library.test.ts`）。実カタログは `getSharedFontCatalogService()` の共有インスタンスを使い、server起動時にバックグラウンドで温める。
- `useMutation` の `data` は新しい `mutate` のpending中に `undefined` へ戻る。テーマ編集プレビューのように `data` だけを描画条件にすると待機中に `<hyperframes-player>` がアンマウントされ、再生位置が0に戻る。直前のHTMLをrefに保持して表示し、プレイヤーを作り直さない。
- `npm test` は vitest を全体並列で実行する。既定の5秒では `packages/contracts/src/agent-operation-contract.test.ts` の digest テストが稀にタイムアウトするため、`vitest.config.ts` の `testTimeout` を30秒にしている（操作カタログの増加に合わせて20秒から引き上げた）。個別実行も同じ設定で動く。
- `packages/video/src/compiler.ts` の `STYLES` 配列へ行を挿入するとき、直前要素の末尾カンマを落としやすい。`npm run typecheck` では構文エラーとして出るが、`tail` で見ると見落とすため、挿入は配列要素ごと置換し、`rg -n` で前後の行のカンマを確認する。
- FFmpeg 6.x（Ubuntu 24.04）では裸の `-autorotate` が次の `-i` を値として消費し、入力が出力扱いになって失敗する。FFmpeg 9 では `-autorotate 1` も拒否する。`apps/api/src/media/normalize.ts` では `-autorotate` を渡さず、既定の自動回転に任せる。
- 新規のプロダクションコードは1ファイル1責務を目安にし、600行以下に保つ。`npm run check:file-size` が600行超を警告、800行超を失敗にする。既存の800行超ファイルは `scripts/check-file-size.mjs` の `BASELINE` に記録されており、分割したらエントリを削除する。baseline を超えて成長させない。

## ユーザーガイド

- `README.md` stays as a project overview. Do not add detailed usage,
  command references, or configuration details to it; link to the user
  guide (https://kakeai.shipweb.jp) instead.
- When adding a user-facing feature or changing existing user-visible
  behavior (Web UI screens, configuration keys),
  update `user-guide/docs/` accordingly.
- Docusaurusのadmonitionでタイトルを付けるときは `:::note[タイトル]` と書く。`:::note タイトル` ではタイトルが反映されない。