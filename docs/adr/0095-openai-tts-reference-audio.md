# OpenAI互換アダプターに参照音声（ICL方式）を追加する

Qwen3-TTS のような参照音声クローンは「声を学習して別モデルとして保存する」方式ではなく、参照音声とその書き起こしを条件に毎回生成する ICL 方式である。mlx-audio-server の `/v1/audio/speech` は既に `ref_audio` / `ref_text` / `lang_code` を受け付けるため、プロファイル側に「声の定義＝参照ペア」を持たせて展開する。声の名前解決をサーバー側に持たせる方式（`voice: "ageha"` をサーバーが参照ペアへ解決する）は採らない。利用者は1人・単一 macOS プロセスで、参照音声は手元のファイルであり、サーバー側に名前解決層を足す後戻りコストに見合わない。

声プロファイルの settings を `{ model, refAudioAssetId?, refText?, langCode?, maxTokens? }` へ拡張する。`refAudioAssetId` の有無が ICL 方式とプリセット方式の判別フラグになる。`refAudioAssetId` がある場合は `refText`・`langCode` を必須化する。プリセット方式（Kokoro など）の既存プロファイルは `{ model }` のまま動き、送信ボディも変えない。

参照音声は Asset として取り込み、`refAudioAssetId` で参照する。`ref_audio` に渡す絶対パスは settings に保存せず、worker が Job 実行時に Asset の `storageKey` から解決する。ファイル移動・削除で静的に壊れる絶対パス保存は採らない。参照中の Asset は `voice_profile` 参照として削除を拒否し、未参照素材の清掃でも残す。参照が外れた Asset は次回の清掃で削除対象になる。

ICL 方式の送信は `{ model, input, ref_audio, ref_text, lang_code, max_tokens, response_format: "wav" }` とし、`voice` と `speed` は送らない。Qwen3-TTS の ICL 経路では `voice` は無視される一方でバッチ判定に影響し、`speed` の対応も未確認のため、CLI 検証済みの形に寄せる。`maxTokens` は省略時に 4096 を送る（サーバー既定 1200 のままだと長文が黙って切れる）。言語コードは Qwen3-TTS の表記（`Japanese` など10言語）を使い、フォームは選択式とする。合成タイムアウトは一覧取得の 30 秒と分け、ICL の初回ロード・参照エンコード・長文生成に合わせて 180 秒とする。

## Considered Options

- `voice: "ageha"` のような名前をサーバー側で参照ペアに解決する。→ mlx-audio-server に解決層の追加が必要で、Kakeai の管理外になるため不採用。案0（クライアント側定義）に相当する形を Kakeai 内で持つ。
- 参照音声の絶対パスを settings に直接保存する。→ ファイル移動・削除で静的に壊れ、Asset の重複排除・来歴・清掃の仕組みから外れるため不採用。取り込み＋参照保護とする。
- 参照音声を Asset 管理外の専用ディレクトリに置く。→ 清掃対象外になるが、重複排除・バックアップ・一覧の仕組みを自前実装することになるため不採用。Asset 参照＋ `findAssetReferences` 拡張で足りる。

## Consequences

- `openAiAdapterExtrasSchema` に任意の 4 フィールドを追加する。既存プロファイル・キュー済み Job スナップショットはそのままパースできるため、`SNAPSHOT_SCHEMA_VERSION` は上げない。
- `TtsSynthesisRequest` に `refAudioPath?` を追加し、worker が解決した絶対パスをアダプターへ渡す。アダプターは DB を見ない。
- Profile 作成・更新時に参照 Asset（実在・音声・ready）を検証し、Job 作成時にも再検証する。解決失敗は Job 実行中の `TTS_INPUT_REJECTED` とする。
- Agent の `voiceProfile.create` / `voiceProfile.update` は同じサービス層を通るため、新フィールドはそのまま使える。エージェント向けに参照音声の取り込み手順（Asset 化して `refAudioAssetId` に指定）をユーザーガイドへ追記する。

Amended by [ADR 0096](./0096-ref-text-optional-xvector.md)（`refText` の必須化を撤回し、省略時は x-vector 方式とする）。
