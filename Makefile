.PHONY: help run run-open

PYTHON ?= $(shell command -v python3 >/dev/null 2>&1 && echo python3 || echo python)
HOST ?= 127.0.0.1
PORT ?= 5500

help:
	@echo "Targets:"
	@echo "  make run       - Start local web server"
	@echo "  make run-open  - Open browser and start local web server"
	@echo ""
	@echo "Overrides:"
	@echo "  make run PORT=5501"
	@echo "  make run HOST=0.0.0.0 PORT=5500"

run:
	$(PYTHON) -m http.server $(PORT) --bind $(HOST)

run-open:
	$(PYTHON) -m webbrowser "http://$(HOST):$(PORT)/index.html"
	$(PYTHON) -m http.server $(PORT) --bind $(HOST)
