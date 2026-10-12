dev:
	npm run dev -w @kakeai/web

dev-restart:
	lsof -ti :4317 | xargs kill 2>/dev/null || true
	npm run dev -w @kakeai/api

restart:
	lsof -ti :4317 | xargs kill 2>/dev/null || true
	npm run build -w @kakeai/web
	npm run start -w @kakeai/api

skill-install:
	mkdir -p ~/Library/Application\ Support/Kakeai/compositions/.agents/skills
	cp -r ./skills/* ~/Library/Application\ Support/Kakeai/compositions/.agents/skills/