# 大規模ファイル分割リファクタリング 仕様

## 目的と背景

この文書は、実装ファイルの肥大化によって機能追加・修正・レビューのコストが上がっている状態を解消するための分割方針を定める。対象はプロダクションコードと、それに付随するテストである。振る舞い・契約・UIは変えない。

背景:

- `apps/web/src/content/form.ts` は約2600行、`apps/web/src/components/SceneEditor.tsx` は約2400行、`packages/video/src/compiler.ts` は約1770行あり、1ファイルに複数の責務が同居している。
- 1つの機能追加で `form.ts`・`SceneEditor.tsx`・`CueList.tsx`・`compiler.ts`・templates を同時に触る構造になっている（[../editor/todo.md](../editor/todo.md) の「同期箇所」）。
- 変更頻度が高いファイルほど大きく、AIエージェントが変更箇所を特定するために数千行を読む必要がある。
- `form.test.ts`（約2580行）や `compiler.test.ts`（約2160行）のような巨大なテストは、失敗箇所の特定と部分実行を遅らせる。

## 対象と優先度

優先度の根拠、対象ファイルの一覧、実行順は [roadmap.md](./roadmap.md) を正とする。実装のチェックリストは [todo.md](./todo.md) を正とする。

## 分割の原則

- **1ファイル1責務**。行数ではなく、変更理由が同じかで切る。
- **公開APIは変えない**。元のファイルを薄いbarrel（再エクスポート）として残し、既存のimportパスを維持する。
- **内部モジュールはbarrelではなく実体ファイルをimportする**。循環依存を避ける。
- **最初は移動だけ**を行う。移動コミットとロジック変更コミットを混ぜない。
- **テストは本体と同時に分割する**。テストだけを後回しにしない。
- **順序が意味を持つデータは並びを変えない**。Agent schema digest、VisualTemplate registry、レンダーHTMLの要素順・tween順が対象。
- **UIは2段階**にする。先に既存サブコンポーネントを移設し、その後で状態フックを抽出する。
- **凝集したモジュールは行数が多くても分割しない**。対象は [roadmap.md](./roadmap.md) の一覧に限定する。

## 目標サイズ

| 種別 | 目標 | 上限の目安 |
| --- | --- | --- |
| プロダクションのロジック | 250〜400行 | 600行 |
| Reactコンポーネント | 200〜400行 | 500行 |
| テスト | 300〜600行 | 800行 |
| barrel | 50行以下 | 100行 |

新規ファイルが上限を超える場合は、分割理由または例外理由をPRに書く。既存ファイルは本リファクタリングで段階的に下げる。

## 分割後の構造

### `packages/contracts/src/templates/index.ts`

```text
packages/contracts/src/templates/
├── index.ts              # 公開APIの再エクスポート
├── shared.ts             # TemplateDisplay / TemplateFieldSpec / VisualTemplateDefinition
├── text-block.ts
├── media.ts              # media.fullBleed / media.card
├── character-standing.ts
├── device-frame.ts
├── site-mockup.ts
├── composition-full-bleed.ts
├── table.ts
├── chart.ts
├── list-callout.ts
├── flow.ts
├── stat.ts
├── quote.ts
├── chat.ts
└── registry.ts           # visualTemplateDefinitions / getVisualTemplate / catalog
```

- `index.ts` は公開APIの再エクスポートだけを持つ。レジストリは `registry.ts` に置く。
- `visualTemplateDefinitions` の順序は変えない。Agent schema digestの入力である。
- `site-mockup.ts` は `device-frame.ts` のスキーマをimportする。テンプレート定義同士の依存は一方向にする。

### `apps/web/src/content/form.ts`

```text
apps/web/src/content/form/
├── types.ts              # DocumentFormValues / SceneFormValue / CueFormValue ...
├── constants.ts          # suffix・既定値・テンプレートID
├── read.ts               # toFormValues / readCueFields / readStanding(s) / characters / speakers
├── cue.ts                # buildCueInput / buildVisualCue(s) / range / nested / playback
├── document.ts           # buildContentDocument / lines / audioTakes / audioCues / accent / transition
├── factories.ts          # ID生成 / empty line / cue既定値 / scene生成 / clone
└── analysis.ts           # lineSummary / 使用数カウント / video gate / prune
```

- `form.ts` はbarrelとして残す。
- `read.ts` と `cue.ts` は対で変更されることが多いため、`toFormValues` → `buildContentDocument` の往復テストを維持する。
- `buildCueInput` が400行を超える場合は、メディア系・データ系・テキスト系に分ける。

### `apps/web/src/api/hooks.ts`

```text
apps/web/src/api/hooks/
├── works.ts              # 作品・言語版
├── assets.ts             # 素材一覧・アップロード・更新・削除・クリーンアップ
├── scriptVersions.ts     # 現在版・履歴・保存・復元・プレビュー
├── jobs.ts               # レンダーJob・作品Job・キャンセル・Artifact削除
├── voices.ts             # Voice Profile / Adapter / Adapter Voices / Models
├── tts.ts                # 単発・一括TTS
├── characters.ts
├── faceSets.ts
├── themes.ts             # Theme / Font Catalog / Draft / Preview
├── compositions.ts
├── thumbnails.ts
└── thumbnailAppearance.ts
```

- `hooks.ts` はbarrelとして残す。
- query keyの文字列とinvalidationは移動だけ。挙動を変えない。

### `packages/video/src/compiler.ts`

```text
packages/video/src/compiler/
├── compile.ts            # compileDocument（オーケストレーター）
├── scene.ts              # sceneループ / cue dispatch / clip尺
├── nested.ts             # nested media/composition / RenderContext
├── characters.ts         # bounce / expression / blink / mouth / face
├── audio.ts              # audio要素 / loop / BGM抑制 / work audio
├── animation.ts          # preset/action vars / value tween
├── transitions.ts        # scene transition / crossfade検証
└── styles.ts             # surface/text CSS / tween変数
```

- `compiler.ts` はbarrelとして残す。
- `compileDocument` は100行前後のオーケストレーターにする。
- 出力HTMLの要素順・tween順を変えない。移動のみ。

### `packages/contracts/src/agent.ts`

```text
packages/contracts/src/agent/
├── protocol.ts           # version / socket / timeout / envelope / error
├── catalog.ts            # operation names / kinds / catalog
├── template.ts           # agent template schema
├── operations/
│   ├── work.ts
│   ├── script.ts
│   ├── assets.ts
│   ├── render.ts
│   ├── preview.ts
│   ├── composition.ts
│   ├── tts.ts
│   └── library.ts        # character / theme / faceSet / voiceProfile
├── schemas.ts            # input/output mapの組み立て
└── contract.ts           # digest / contracts / buildAgentSchemaGetResult
```

- `agent.ts` はbarrelとして残す。
- `agentOperationNames` の順序と `visualTemplateDefinitions` の順序を変えない。
- `agent.test.ts` の固定digest（`fnv1a64:dfbb1f98a6d14526`）を最後の砦にする。

### `apps/web/src/components/SceneEditor.tsx`

```text
apps/web/src/components/
├── SceneEditor.tsx       # コンテナ（Phase 3では現状維持）
└── scene-editor/
    ├── SceneBlock.tsx
    ├── InsertSceneFields.tsx
    ├── TimingFields.tsx
    ├── SceneToolbar.tsx          # Phase 5
    ├── useSceneEditorForm.ts     # Phase 5
    ├── useSceneStructure.ts      # Phase 5
    ├── useDraftPreviewSync.ts    # Phase 5
    └── useBulkTts.ts             # Phase 5
```

- Phase 3では `TimingFields` / `InsertSceneFields` / `SceneBlock` の移設だけを行う。
- Phase 5でフォーム・構造操作・プレビュー同期・一括TTSをフックに分ける。
- propsの受け渡しが複雑な場合は、フック抽出後に `SceneEditorContext` の導入を検討する。ただし移動コミットには混ぜない。

### `apps/web/src/components/CueList.tsx`

```text
apps/web/src/components/
├── CueList.tsx           # コンテナ
└── cue-list/
    ├── CueRow.tsx
    ├── CueField.tsx
    ├── CompositionVersionField.tsx
    ├── PositionZoomControls.tsx
    ├── NestedScreenField.tsx
    └── CueVideoPlaybackField.tsx
```

### `apps/web/src/components/LinesEditor.tsx`

```text
apps/web/src/components/
├── LinesEditor.tsx       # コンテナ
└── lines-editor/
    ├── LineEditor.tsx
    ├── LineActionsMenu.tsx
    ├── LineTtsPanel.tsx
    └── useLineStructuralOps.ts
```

### `apps/api/src/services/script-versions.ts`

```text
apps/api/src/services/script-versions/
├── save.ts               # 保存・attribution・競合・guard
├── references.ts         # FaceSet / Asset / 参照の読み込み
├── assertions.ts         # FaceSet・Asset・Take・insert・video playbackの検証
├── history.ts            # 現在版・履歴・取得・字幕
└── preview.ts            # プレビューのtimeline / compile / draft preview
```

- `script-versions.ts` はbarrelとして残す。
- 保存時の検証順序（最初のエラーが返る順）を変えない。

### `apps/api/src/services/assets.ts`

```text
apps/api/src/services/assets/
├── ingest.ts             # アップロード取り込み・重複排除・Job投入
├── list.ts               # カーソル・フィルタ・検索
├── manage.ts             # 取得・更新・削除・参照検索
└── content.ts            # 配信ファイルの解決
```

- `assets.ts` はbarrelとして残す。

### `apps/api/src/services/compositions.ts`

```text
apps/api/src/services/compositions/
├── validation.ts         # manifest・パス・外部URL・draftファイルの検証
├── service.ts            # CompositionService
└── queries.ts            # 尺・Canvas Profileの一括取得
```

- `compositions.ts` はbarrelとして残す。

### `apps/api/src/agent/operations.ts`

```text
apps/api/src/agent/operations/
├── types.ts
├── work.ts
├── script.ts
├── assets.ts
├── render.ts
├── preview.ts
├── composition.ts
├── tts.ts
├── library.ts
├── registry.ts           # definitionsの組み立て
└── dispatch.ts           # runOperation / dispatchAgentOperation
```

- `operations.ts` はbarrelとして残す。
- `agent.ts` のoperation分割と同じドメイン名を使う。

### `apps/web/src/pages/ThemeDetailPage.tsx`

```text
apps/web/src/pages/
├── ThemeDetailPage.tsx   # コンテナ
└── theme-detail/
    ├── ColorsTab.tsx
    ├── TypographyTab.tsx
    ├── SurfacesTab.tsx
    ├── SkinTab.tsx
    ├── CaptionTab.tsx
    ├── ThemePreviewPane.tsx
    └── useThemePreviewPlayback.ts
```

### `apps/web/src/content/structural.ts` / `cueMap.ts`

```text
apps/web/src/content/structural/
├── scene.ts
├── line.ts
├── cue.ts
├── standing.ts
├── audio.ts
└── common.ts

apps/web/src/content/cue-map/
├── model.ts
├── layout.ts
└── geometry.ts
```

- `structural.ts` / `cueMap.ts` はbarrelとして残す。
- 操作ファミリの意味論は変えない。

## 非目標

- 振る舞い・契約・DBスキーマ・UI文言の変更。
- 新しい抽象化やデザインパターンの導入。分割に必要な最小限のモジュール化だけを行う。
- 行数だけを理由にした機械的な分割。
- `packages/video/src/timeline.ts` や `packages/script-edits/src/apply.ts` のような、責務が1つにまとまっているファイルの分割。
- 生成コード（`apps/api/src/generated`）やビルド成果物の整理。
- UIデザインの変更、コンポーネントライブラリの導入。

## 受け入れ条件

- [roadmap.md](./roadmap.md) の優先度S/Aのファイルが、目標サイズ内のモジュールに分割されている。
- 公開exportとimportパスに互換性がある。既存の呼び出し側を原則変更しない。
- `npm run typecheck` と `npm test` が通る。
- Agent schema digest、VisualTemplate registryの順序、レンダーHTMLがリファクタリング前後で変わらない。
- 各Phaseの完了時に、変更が移動中心であることをレビューで確認できる。
- 新規ファイルは1責務で、テストファイルが対応する本体モジュールを特定できる。

## 決定しないこと

- ファイル分割は後戻りコストが小さいため、ADRは作らない。方針を変える場合はこの文書と [roadmap.md](./roadmap.md) を更新する。
- ファイルサイズのCI強制は、主要な分割が完了した後に [todo.md](./todo.md) のPhase 6で導入する。
