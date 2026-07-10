.PHONY: test serve lint clean install help

help:
	@echo "Available targets:"
	@echo "  test    - Run all tests"
 	@echo "  serve   - Start dev server with hot reload (port 3000, LAN-accessible)"
	@echo "  lint    - Run basic code checks"
	@echo "  clean   - Remove node_modules"
	@echo "  install - Install dependencies"

test:
	npm test

serve:
	npx live-server --port=3000 --host=0.0.0.0 --no-browser --watch=src/,index.html

lint:
	npx eslint src/ --ext .js

clean:
	rm -rf node_modules package-lock.json

install:
	npm install
