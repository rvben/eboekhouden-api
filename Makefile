-include .env
export

HOST ?= $(error Set HOST in .env or environment, e.g. HOST=root@your-server)
REMOTE_DIR ?= /opt/eboekhouden-api

.PHONY: up down setup deploy logs restart stop

up:
	docker compose up --build

down:
	docker compose down

setup:
	ssh $(HOST) 'bash -s' < setup.sh

deploy:
	ssh $(HOST) 'mkdir -p $(REMOTE_DIR)/src/routes'
	scp package.json Dockerfile docker-compose.yml .env $(HOST):$(REMOTE_DIR)/
	scp src/server.mjs src/eboekhouden.mjs src/db.mjs src/errors.mjs src/routes.mjs $(HOST):$(REMOTE_DIR)/src/
	scp src/routes/offerte.mjs src/routes/read.mjs src/routes/relatie.mjs $(HOST):$(REMOTE_DIR)/src/routes/
	ssh $(HOST) 'cd $(REMOTE_DIR) && docker compose up -d --build'

logs:
	ssh $(HOST) 'cd $(REMOTE_DIR) && docker compose logs -f'

restart:
	ssh $(HOST) 'cd $(REMOTE_DIR) && docker compose restart'

stop:
	ssh $(HOST) 'cd $(REMOTE_DIR) && docker compose down'
