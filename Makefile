dev:
	npm run dev -w @kakeai/web

dev-restart:
	lsof -ti :4317 | xargs kill 2>/dev/null || true
	npm run dev -w @kakeai/api