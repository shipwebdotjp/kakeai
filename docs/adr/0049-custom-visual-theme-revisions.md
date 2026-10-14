# 利用者編集可能な Visual Theme を不変revisionとdraftに分ける

Visual Themeをアプリ共通ライブラリとして利用者が作成・編集できるようにする。ただし、Script VersionとRender Jobが参照できるのは不変の公開Theme Revisionだけとし、編集途中のTheme Draftはテーマ編集画面のプレビュー専用にする。テーマ更新を自動追従させず、利用者が公開revisionを選び、通常の明示保存で新しいScript Versionを作ることで適用する。これにより、自由なテーマ調整と過去の作品・レンダーの意図の保持を両立する。

## Considered Options

- テーマ定義を上書きする。→ 既存Script Versionの見た目が遡及して変わり、プレビューとレンダーの追跡ができなくなるため不採用。
- 編集のたびに公開revisionを作る。→ ライブプレビューのための試行で履歴が汚れ、不要な版を増やすため不採用。
- テーマをWorkだけに保存する。→ 複数作品での再利用と、Script Versionごとの意図の固定を両立できないため不採用。

## Consequences

- 組み込みテーマはアプリ管理のまま不変で、複製して初めて利用者テーマになる。
- Theme Draftは正本JSON、Render Job、MP4出力から参照できない。テーマ編集のサンプルプレビューだけが定義overrideとして読む。
- ローカルのFont Faceをテーマに保存できる。欠落時は保存を拒否せず、プレビューとレンダー前に警告し、定義済みfallbackで描画する。
