SHELL := /bin/sh
DC := docker compose

up:
	$(DC) up -d --build

down:
	$(DC) down

logs:
	$(DC) logs -f

bash:
	$(DC) exec web bash

migrate:
	$(DC) exec web python manage.py migrate

createsuperuser:
	$(DC) exec web python manage.py createsuperuser

test:
	$(DC) exec web pytest

fmt:
	$(DC) exec web black .
	$(DC) exec web isort .

lint:
	$(DC) exec web ruff check .
