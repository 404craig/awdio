.PHONY: setup dev build test preview

setup:            ## install dependencies
	cd web && npm install

dev:              ## Vite dev server on :5173 (add ?demo=1 for sample documents)
	cd web && npm run dev

build:            ## production build into web/dist (BASE_PATH=/awdio/ for GitHub Pages)
	cd web && npm run build

test:             ## typecheck and unit tests
	cd web && npm run typecheck && npm test

preview: build    ## serve the production build on :4173
	cd web && npm run preview
