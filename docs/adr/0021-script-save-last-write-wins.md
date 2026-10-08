# 台本保存はlast-write-winsとし、楽観ロックを省く

台本保存ではクライアントに `baseScriptVersionId` を要求せず、`409 VERSION_CONFLICT` も返さない。保存は最後の書込みを採用し、`currentScriptVersionId` を新しい版へ進める。版は不変で履歴が残るため、複数タブの衝突が起きても編集内容は失われず、利用者は過去版から復元できる。競合UIと差分確認はMVPでは作らない。

## Considered Options

- baseScriptVersionId で楽観ロックする。→ 単一利用者では衝突が稀で、競合UIの実装が見合わないため不採用。
