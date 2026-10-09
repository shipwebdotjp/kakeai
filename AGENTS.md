# AGENTS.md

Kakeai は、編集意図（正本JSON）をレンダー済みメディアから分離して保持する、個人用ローカル動画制作アプリ。macOS上で単一プロセス起動するWebアプリで、オフラインで日本語の解説動画をMP4出力する。

## 正となる文書

実装の判断は次の文書を正とする。矛盾を見つけたらコードより文書を優先し、必要なら文書とADRを更新する。

- [docs/mvp/spec.md](docs/mvp/spec.md): 全体仕様・DBスキーマ・Job状態遷移
- [docs/mvp/content-schema.md](docs/mvp/content-schema.md): 台本の正本JSON契約
- [docs/mvp/api-contract.md](docs/mvp/api-contract.md): HTTP API契約・DTO・エラー
- [docs/mvp/todo.md](docs/mvp/todo.md): 実装フェーズ
- [docs/adr/](docs/adr/): 決定記録。反転させる場合は新ADRを追加し、旧ADRに `superseded by` / `amended by` を付ける
- [CONTEXT.md](CONTEXT.md): 用語集（実装詳細は書かない）

## docs の運用

- 新機能は `docs/<feature>/` を切り、その中に `spec.md` と `todo.md` を置いて開発する。実装の判断はそのフォルダの文書を正とする。既存のMVPは [docs/mvp/](docs/mvp/)。
- 用語は [CONTEXT.md](CONTEXT.md) に集約する。実装詳細は書かない。
- ADRは `docs/adr/NNNN-slug.md` に **1決定=1ファイル** で追加する。番号は既存の最大+1。
- ADRは重大で後戻りコストの大きい決定だけ記録する。細かな実装選択や簡単に戻せる決定はADRにしない。決定を反転させる場合は新ADRを追加し、旧ADRに `superseded by` / `amended by` を付ける。

## コマンド

```
npm install        # 依存のインストール
npm run typecheck  # 全ワークスペースの型検査
npm test           # vitest（{packages,apps}/*/src/**/*.test.ts）
```

変更後は必ず `npm run typecheck` と `npm test` を通す。

## 構成

- `packages/contracts`: Zodスキーマと型の唯一の定義場所。API・フォーム・復元・検証はここから導出した型だけを使う。
- `packages/video`: Compositionコンパイラと信頼済みVisualTemplate（P4で追加）。
- `apps/api`: Express + Prisma。workerループを内蔵し、単一プロセスで起動する（P1以降）。
- `apps/web`: Vite + React + TypeScript + Tailwind CSS（P2以降）。

## 実装ルール

- **契約が先**: 型は原則 `z.infer` で導出し、`packages/contracts` に集約する。API入出力・ContentDocument・VisualTemplate入力をZodで検証し、無検証でレンダーへ渡さない。
- **コメントを書かない**: コードにコメントを追加しない。意図は名前と型で表す。
- **正本と派生**: 正本はSQLiteの不変 `ScriptVersion.contentJson`。Composition HTML・MP4・フレームは派生物とし、正本にしない。
- **スキーマ版**: ContentDocument は `schemaVersion: 1` から開始。移行コードを先回りして持たない。破壊的変更時に版を上げて新ScriptVersionで移行する。JCS正規化や `contentHash` は持たない（キー順を安定させたJSON文字列で保存）。
- **ID**: `NarrationSegment` と Scene のIDは同一Workの版をまたいで安定させ、編集保存で作り直さない。
- **素材**: 原本を保持し、原則そのまま使う。原本を直接レンダーに使えない場合だけ必要時に `AssetRendition` を作る。`storageKey` は内容ハッシュ由来。
- **テンプレート**: `template.id@version` の意味を不変に保ち、変更は新版で行う。参照ゼロの版は削除可。VisualTemplate入力スキーマも版ごとに固定する。
- **Job**: 単一worker、`queued → running → succeeded|failed` と `queued → cancelled` のみ。リースは持たず、起動時に `running` を `WORKER_INTERRUPTED` で掃除する。二重取得は `updateMany` のbest-effortで足りる。
- **台本保存**: 明示保存（自動保存なし）。last-write-wins。テキストあふれは拒否せず `meta.warnings` で返す。
- **保護**: ループバックに束縛し、JSON/アップロードは厳密な `Host`/`Origin` 検証、content配信は `HttpOnly; SameSite=Strict` のメディアセッションCookie。独自ヘッダや起動トークンは使わない。
- **保存先**: OSのアプリデータ領域をルートにし、開発時は `KAKEAI_DATA_DIR` で差し替える。絶対パスを正本へ埋め込まない。
- **非ゴール**: マルチユーザー、分散レンダリング、高可用性、認証、クラウド保存。

## テスト

- 必要最低限にする。振る舞いと契約（入出力・スキーマ・境界）をテストする。
- プロンプト・メッセージ・UI文言を検証するテストは書かない。文言は頻繁に変わり、false failureを生むため。

## 作業の進め方

- [docs/mvp/todo.md](docs/mvp/todo.md) のフェーズ順に進め、完了したらチェックを付ける。
- 仕様・契約を変えたら、対応する文書とADRを同じ変更で更新する。

## レビューとコミット

コードの実装や影響の大きい変更では、次の流れを1サイクルとして行う。

1. `ocr review --audience agent -b "<変更の背景>" > /tmp/ocr_review.txt 2>&1` でレビューし、指摘を確認する。
2. 正当な指摘のみを修正する。
3. 再度レビューして修正する。ocrレビューは最大3回までで打ち切る。
4. コミットする。

- 文書のみの軽微な変更はレビューを省略してよい。
- コミットメッセージは変更の意図を簡潔に書く。
- 複数回失敗したテスト操作や、コーディングミスで、回避策や対策が明らかなものについては、以降同じ轍を踏まないよう、AGENTS.mdの「## コーディングおよびテスト実行時注意事項」セクションに記載する。

## コーディングおよびテスト実行時注意事項

## ユーザーガイド

- `README.md` stays as a project overview. Do not add detailed usage,
  command references, or configuration details to it; link to the user
  guide (https://kakeai.shipweb.jp) instead.
- When adding a user-facing feature or changing existing user-visible
  behavior (Web UI screens, configuration keys),
  update `user-guide/docs/` accordingly.
- Docusaurusのadmonitionでタイトルを付けるときは `:::note[タイトル]` と書く。`:::note タイトル` ではタイトルが反映されない。