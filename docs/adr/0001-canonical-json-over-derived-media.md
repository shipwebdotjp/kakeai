# 正本は自作の構造化JSONとし、派生メディアを正本にしない

作品の編集データの正本は自作の構造化JSON（`ScriptVersion.contentJson`）とし、HyperFrames Composition HTML、開始・終了フレーム、出力MP4はそこから導出する派生物として正本にしない。理由は、レンダラーを差し替えても（HyperFrames → MLT 等）、テンプレートを更新しても、編集意図・版履歴・再現性を保持できるようにするため。各製品の内部表現を正本にすると、差分・監査・多言語展開・派生Workがその製品の都合に縛られる。

## Considered Options

- HyperFrames Composition HTML を正本にする。
- 外部製品（Remotion の `EditorState`、MLT XML、SRT 等）の内部表現を正本にする。→ いずれも採用しない。

## Consequences

自作の JSON→Composition コンパイラと、信頼済みの VisualTemplate 群を保守する必要がある。入力検証（Zod）を正本の入口に置き、派生メディアから正本へ逆流させない。
