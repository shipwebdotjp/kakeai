# ライブCue単位の素材カード TODO

[spec.md](./spec.md) を正とする。

## P1. 契約と書き出し

- [x] `LiveShowProfile.scriptCues[].materialId` に `string | null | 未指定` を追加する。
- [x] `PreparedCue` と `LiveCue` に同じ任意フィールドを追加し、生値を保持する。
- [x] `ResolvedCueSeed` と `prepareAudio` で `materialId` を保持する。
- [x] Show Profile検証で、存在しない素材IDとCueの重複参照を拒否する。
- [x] パッケージ読込検証で、存在しない素材IDとCueの重複参照を拒否する。
- [x] 既存Profileと既存Packageがそのまま読めることを契約テストで確認する。

## P2. ランタイムとステージ

- [x] `StageState.material` をSegment固定ではなく、現在CueとSegment既定から解決する。
- [x] Cueの3値の優先順位を純粋関数に集約し、テストする。
- [x] 本編を常に `script` フェーズにし、`material` フェーズを削除する。
- [x] コンソールのフェーズ表示と関連テストを更新する。
- [x] ステージで画像素材がSegment既定からCue指定へ切り替わり、本編が`script`フェーズのままであることを手動で確認する。動画の非再スタート・ミュート・ループは既存のステージ実装を変更していない。
- [x] 素材の先読み・キャッシュを実装しない。
- [x] 素材エラーのコンソール通知を実装しない。

## P3. 文書と確認

- [x] `docs/live/spec.md` のProfile、出力、フェーズ、状態、失敗時挙動を更新する。
- [x] `docs/mvp/api-contract.md` のライブ書き出し入力検証に `scriptCues[].materialId` を追加する。
- [x] ユーザーガイドのShow Profile説明に3値の意味を追加する。
- [x] `CONTEXT.md` のLive Cue定義を実効素材の解決に合わせる。
- [x] `npm run typecheck` と `npm test` を通す。
- [x] OCRレビューと修正後の再レビューを行い、コミットする。
