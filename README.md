# Anexo Automático

Micro-SaaS para automatizar anexos. Proyecto Django preparado para desarrollo local con Docker Compose.

## Requisitos
- Docker Desktop (WSL2)
- Git

## Levantar el stack local
1. Copia variables de entorno:
   - `cp .env.example .env`
2. Construye y levanta:
   - `docker compose up -d --build`

## Migraciones
- `docker compose exec web python manage.py migrate`

## Crear superusuario
- `docker compose exec web python manage.py createsuperuser`

## Verificar endpoints
- Healthcheck:
  - `http://localhost:8000/health/` -> `{"status":"ok"}`
- Landing:
  - `http://localhost:8000/`

## Comandos rápidos (Makefile)
Si tienes `make` disponible:
- `make up`
- `make down`
- `make logs`
- `make bash`
- `make migrate`
- `make createsuperuser`
- `make test`
- `make fmt`
- `make lint`

## Variables de entorno (.env)
Revisa `.env.example` y completa lo necesario:
- `SECRET_KEY`
- `DEBUG`
- `ALLOWED_HOSTS`
- `CSRF_TRUSTED_ORIGINS`
- `DATABASE_URL`
- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `CELERY_BROKER_URL`
- `CELERY_RESULT_BACKEND`
- `MINIO_ROOT_USER`
- `MINIO_ROOT_PASSWORD`
- `MINIO_ENDPOINT`
- `MINIO_USE_SSL`
