.PHONY: test serve lint clean install help

help:
	@echo "Available targets:"
	@echo "  test    - Run all tests"
	@echo "  serve   - Start dev server (port 3000, LAN-accessible)"
	@echo "            PROXY=false disables /api proxy"
	@echo "            PROXY_TARGET=host:port sets backend (default: localhost:8080)"
	@echo "  lint    - Run basic code checks"
	@echo "  clean   - Remove node_modules"
	@echo "  install - Install dependencies"

test:
	npm test

serve:
	node dev-server.js

lint:
	npx eslint src/ --ext .js

clean:
	rm -rf node_modules package-lock.json

install:
	npm install
