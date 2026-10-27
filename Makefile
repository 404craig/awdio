.PHONY: setup dev build run test server web

setup:            ## install server (uv) and web (npm) dependencies
	cd server && uv sync
	cd web && npm install

server:           ## dev API server on :8000 with reload
	cd server && uv run uvicorn awdio.main:app --reload --host 0.0.0.0 --port 8000

web:              ## Vite dev server on :5173 (proxies /api to :8000)
	cd web && npm run dev

dev:              ## run both dev servers
	$(MAKE) -j2 server web

build:            ## build the frontend into web/dist (served by the API server)
	cd web && npm run build

run: build        ## production: single process on :8000
	cd server && uv run uvicorn awdio.main:app --host 0.0.0.0 --port 8000

test:             ## run server tests and web typecheck/tests
	cd server && uv run pytest -q
	cd web && npm run typecheck && npm test --if-present
