.PHONY: help test run run-open

HOST ?= 127.0.0.1
PORT ?= 5500

help:
	@echo "Targets:"
	@echo "  make test      - Run smoke tests"
	@echo "  make run       - Start local web server"
	@echo "  make run-open  - Open browser and start local web server"
	@echo ""
	@echo "Overrides:"
	@echo "  make run PORT=5501"
	@echo "  make run HOST=0.0.0.0 PORT=5500"

run:
	python -m http.server $(PORT) --bind $(HOST)

test:
	python scripts/smoke_test.py

run-open:
	python -m webbrowser "http://$(HOST):$(PORT)/index.html"
	python -m http.server $(PORT) --bind $(HOST)
