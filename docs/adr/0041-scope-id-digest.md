# Scope ID を短いダイジェストにする

Cue scope の要素ID生成を、可逆な16進展開（1文字→6桁）から決定的な64bitダイジェスト（FNV-1a 32bit×2、16桁hex固定）に変える。

- 現象として、展開後の要素ID（約445文字）がHyperFramesのフレーム抽出ディレクトリ名に使われ、macOSのファイル名上限（255バイト）を超えて `ENAMETOOLONG` でレンダーが失敗した。
- 可逆性を利用する復号処理は存在しなかったため、可逆性の維持より長さの上限保証を優先する。
- 衝突耐性は同一Composition内のCue数に対して十分で、依存追加なし・ブラウザ同形のまま実装できる。

## Considered Options

- UTF-8バイト列の16進展開（1バイト→2桁）。→ ASCII主体のCue IDでは短くなるが、長いScene IDでは上限超過が再発しうるため不採用。
- `node:crypto` のSHA-256切り詰め。→ 依存がNode専用になり、パッケージの同形性を損なうため不採用。
- 単純な切り詰め。→ 衝突耐性が下がるため不採用。

## Consequences

- `packages/video/src/scope.ts` をダイジェスト方式に置換し、`scope.test.ts` で長さ・決定性・識別性を検証する。
- [ADR-0030](./0030-composite-visual-template-isolation.md) の「可逆なDOM-safe文字列」の記述を本ADRで改める。
- `docs/composite-visuals/spec.md` の分離規約をダイジェスト方式に更新する。
