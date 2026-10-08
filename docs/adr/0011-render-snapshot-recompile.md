# レンダーは入力スナップショットを固定し、ワーカーが実行時に再コンパイルする

Render Job は、`ScriptVersion` の `contentJson` と `contentHash`、選択した Asset と render Rendition の ID・SHA-256・メタデータ、テンプレートの `id@version`、出力設定を `inputSnapshotJson` に固定する。Composition HTML はキュー投入時に固定せず、ワーカーが実行時にインストール済みの信頼済みテンプレートで再コンパイルする。MP4のバイト単位・見た目の完全一致は要件にしない。

理由は、編集内容と素材選択は不変に保ちつつ、テンプレート実装やツールの改善を許容するため。完全再現性を求めると Chrome・FFmpeg・フォントまでバイト単位で固定する運用コストがMVPに見合わない。編集意図の安定は、テンプレート版の不変性（[ADR-0009](./0009-template-version-immutability.md)）と `contentJson` の不変性（[ADR-0002](./0002-script-version-immutability-canonicalization.md)）で担保する。

## Considered Options

- Job作成時にComposition HTMLを固定し、ワーカーは再コンパイルせず実行する（旧 [ADR-0003](./0003-render-determinism-frozen-html.md)）。→ ツール更新を許容する方針と衝突し、運用コストが高いため採用しない。
- Chrome・FFmpeg・フォントのハッシュまで固定する。→ 過剰なため採用しない。

## Consequences

Jobスナップショットには実行環境の版を診断用に記録するが、再現性の保証には使わない。ツール更新時は代表素材でレンダー回帰テストを実行する。ワーカーは過去のテンプレート版を描画できる必要があるため、版の描画コードは削除しない。
