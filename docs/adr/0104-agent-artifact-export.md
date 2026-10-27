# エージェントのワークスペースへの Artifact 書き出し

Status: accepted

## 背景

`artifact.get` は Artifact の正本（データルート内の絶対パス）を返す（[ADR 0103](./0103-agent-subtitles-and-artifact-path.md)）。エージェントはそのパスをコピーできるが、レンダー結果を自分のワークスペースへ直接受け取りたいという要求がある。

レンダー自体を任意のディレクトリへ書かせる案は、次の点で既存の前提を崩す。

- `Artifact.storageKey` は `resolveStoragePath` でデータルート内に閉じている。HTTP の `contentUrl`、`deleteArtifact`、サイズ検証、保持期間の掃除がすべてこの前提に依存する。
- レンダー Job の成功と、書き出し先へのコピー成功が混ざる。コピーだけ失敗したときに Job を `succeeded` にするか `failed` にするかが決められない。
- レンダーは一時ディレクトリで行い、`commitFile` で正本を作る。外部パスを正本にすると、Artifact のモデルと UI のダウンロードを作り直す必要がある。

一方、書き出しは同一ユーザーのローカルアプリにおけるファイル作成であり、エージェントは元々ワークスペースへファイルを書ける。許可リストを設けず、任意の絶対ディレクトリを許可する方針とする。

## 決定

`artifact.export`（mutation）を追加する。正本はデータルートに残したまま、呼び出し側が指定したディレクトリへコピーする。`AGENT_PROTOCOL_VERSION` は `1` のまま据え置く。

- 入力は `{ artifactId, outputDir, filename? }`。`outputDir` は存在する絶対ディレクトリ。`filename` はパス区切りを含まない basename で、Artifact の拡張子（mp4 / png / jpg / jpeg / vtt）に一致しなければならない。
- `filename` を省略すると、Work タイトルと Artifact ID から `<title>-<artifactId>.<ext>` を生成する。ファイル名に使えない文字は `-` に置換し、長さを制限する。
- 既存ファイルは上書きしない。同名があれば `EXPORT_TARGET_EXISTS` を返す。上書きオプションは設けない。エージェントは別名を選ぶか、自分のツールで既存ファイルを整理する。
- コピーは `COPYFILE_FICLONE` を試し、ファイルシステムが未対応なら通常コピーへフォールバックする。同一ディレクトリ内の一時ファイルへコピーし、ハードリンクで公開する。ハードリンクは既存名があると `EEXIST` で失敗するため、競合しても上書きしない。ハードリンクを持たないファイルシステムでは排他的コピーへフォールバックする。失敗時は一時ファイルを消す。
- `outputDir` が相対パス・非ディレクトリ・不存在なら `VALIDATION_ERROR`、コピー失敗は `EXPORT_FAILED`、Artifact や正本ファイルが無ければ `RESOURCE_NOT_FOUND`。
- 書き出したコピーはアプリの管理外とする。Artifact の削除や保持期間の掃除では消さない。

`artifact.get` は従来どおり正本の `filePath` を返す。`artifact.export` は `{ artifact, sourcePath, exportedPath }` を返す。`sha256` は DTO に追加しない（必要なら呼び出し側で計算できる）。

## Considered Options

- `render.start` に `outputDir` を載せ、ワーカーがコピーする。→ コピー失敗時に Job の状態が曖昧になり、`exportedPath` を保存する DB 列または Job result の拡張も必要になる。レンダーと納品を分離する。
- 任意のディレクトリへ直接レンダリングする。→ Artifact の正本・HTTP 配信・削除・保持の前提を崩す。大きなモデル変更になる。
- 許可リストを設ける。→ 同一ユーザーのローカルアプリで、エージェントは元々ワークスペースへ書ける。設定負荷に見合わないため設けない。ただし既存ファイルは上書きしない。
- 上書きオプションを設ける。→ 取り消しのない破壊的操作になる。必要なら新しい ADR で、バックアップや確認手段と合わせて判断する。
- サンドボックス化されたエージェント向けにバイトを返す。→ 大きな MP4 に不向き。`artifact.content` は将来の課題とする。

## Consequences

- Agent Access 仕様の MCP 操作表・操作詳細・エラー表、roadmap、todo、MP4 制作仕様・ロードマップ、制作スキル、ユーザーガイドを更新する。`operationDigest` と `schemaDigest` は変わり、束縛（MCP / CLI）とアプリは同じビルドで揃える。
- エージェントは `artifact.export` で MP4 をワークスペースへ出し、投稿ツールへ渡せる。書き出し先はアプリの保持対象外なので、利用者が管理する。
- 大きなファイルのコピーは変更操作の 120 秒を超えることがある。タイムアウトしても処理は中断されないため、`exportedPath` の有無を確認してから再実行する。
- この決定は恒久ではない。上書きや許可リスト、バイト返却が必要になった場合は、取り消し手段と合わせて新しい ADR で判断する。
