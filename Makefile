dev:
	npm run dev -w @kakeai/web

dev-restart:
	lsof -ti :4317 | xargs kill
	npm run dev -w @kakeai/api