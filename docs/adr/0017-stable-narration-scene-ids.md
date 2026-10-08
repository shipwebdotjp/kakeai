# NarrationSegmentとSceneのIDは同一Workの版をまたいで安定とする

`ContentDocument` 内の `NarrationSegment.id`（line ID）とScene IDは、同一Workの版をまたいで一意かつ安定とし、編集保存のたびに作り直さない。VisualCueの `range` がラインIDで区間を指し、将来の翻訳・派生WorkがこのIDで元の行へ対応付けるため。MVPでは実装を要求せず、IDの意味だけを固定する。

## Consequences

翻訳やTTSの追加時に、言語版間の行対応をIDで辿れる。編集で行を追加・削除した場合のID再利用規則は、実装時に別途定める。
