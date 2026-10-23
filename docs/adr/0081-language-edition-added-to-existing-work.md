# ADR-0081: 第2言語版は既存 Work への LanguageEdition 追加とする

## 状況

日本語原本から英語版などを作れるようにする（[../mvp/roadmap.md](../mvp/roadmap.md) Phase 4）。第2言語版をどこにぶら下げるかの選択肢は、既存 Work へ `LanguageEdition` を追加するか、`Work` を複製して別言語の Work にするかである。既存の `cloneWork` は同一 locale 専用の複製である。

## 決定

- 第2言語版は既存 Work へ `LanguageEdition` を追加して作る。`POST /works/:workId/language-editions` と Agent Access の `edition.create` を追加する。
- 初期版はシード元 Edition の current contentJson を深いコピーし、`document.locale` の置換、話者 `voiceProfileId` の null 化、`audioTakes` の空化と `selectedAudioTakeId` の null 化を行う。`sourceScriptVersionId` にシード元を記録する。
- 言語版の作成後は Edition をほぼ独立した別物として編集する（同期は [ADR-0082](./0082-no-edition-sync-tracking.md)）。

## 理由

- `Work` は原本言語を持つ親単位であり、「ある作品の言語別制作版」は既存モデルの `LanguageEdition` の役割である。サムネイルなど Edition 単位の機能が既に Edition を基準にしており、Work 複製だとそれらが言語ごとに Work をまたいで分裂する。
- 見た目を共有する（キャラクターは言語中立、[../multilingual-voice/spec.md](../multilingual-voice/spec.md)）理念は Edition をまたぐ形が自然である。
- シードコピーにより Scene 構成・素材参照・stable ID が引き継がれ、人はテキストと声を差し替えるだけでよい。

## 不採用

- Work を複製して別言語 Work にする。cloneWork の流用で実装は早いが、Edition 単位の機能が Work 単位へずれ、Phase 5 の派生 Work（縦型ショートの親子）とも干渉する。
- 初期版を空テンプレートから作る。Scene 構成・素材割当の再構築を人に強いことになり、「日本語版を元に」の要件から外れる。

superseded by / amended by なし。
