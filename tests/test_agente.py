import hashlib
import json
from datetime import timedelta

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone

from agente.models import AgentToken
from ingesta.models import (
    AsignacionClasificacionFactura,
    Categoria,
    Confianza,
    Factura,
    Importacion,
    Proveedor,
)


@pytest.mark.django_db
def test_create_token_and_me(client):
    user = get_user_model().objects.create_user(
        username="agent-user",
        email="agent@example.com",
        password="pass1234",
    )
    client.force_login(user)
    importacion = Importacion.objects.create()

    response = client.post(
        "/api/agent/tokens",
        data=json.dumps({"allowed_importacion_id": importacion.id}),
        content_type="application/json",
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["token"]
    assert payload["expires_at"]

    response = client.get(
        "/api/agent/me",
        HTTP_AUTHORIZATION=f"Bearer {payload['token']}",
    )

    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True
    assert data["allowed_importacion_id"] == importacion.id


@pytest.mark.django_db
def test_token_expired_or_revoked_returns_401(client):
    raw_expired = "expired-token"
    expired_hash = hashlib.sha256(raw_expired.encode("utf-8")).hexdigest()
    AgentToken.objects.create(
        token_hash=expired_hash,
        expires_at=timezone.now() - timedelta(minutes=1),
    )

    response = client.get(
        "/api/agent/me",
        HTTP_AUTHORIZATION=f"Bearer {raw_expired}",
    )
    assert response.status_code == 401

    raw_revoked = "revoked-token"
    revoked_hash = hashlib.sha256(raw_revoked.encode("utf-8")).hexdigest()
    AgentToken.objects.create(
        token_hash=revoked_hash,
        expires_at=timezone.now() + timedelta(hours=1),
        revoked_at=timezone.now(),
    )

    response = client.get(
        "/api/agent/me",
        HTTP_AUTHORIZATION=f"Bearer {raw_revoked}",
    )
    assert response.status_code == 401


@pytest.mark.django_db
def test_token_can_download_plan_json(client):
    proveedor = Proveedor.objects.create(ruc="999", razon_social="Proveedor API")
    factura = Factura.objects.create(proveedor=proveedor, clave_acceso="CLAVE-API-1")
    categoria = Categoria.objects.create(nombre="SALUD")
    AsignacionClasificacionFactura.objects.create(
        factura=factura,
        categoria_sugerida=categoria,
        confianza=Confianza.HIGH,
    )
    importacion = Importacion.objects.create(
        log_json={"files": [{"factura_id": factura.id}]}
    )

    raw_token = "valid-token"
    token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
    AgentToken.objects.create(
        token_hash=token_hash,
        expires_at=timezone.now() + timedelta(hours=1),
        allowed_importacion=importacion,
    )

    response = client.get(
        f"/api/agent/importaciones/{importacion.id}/plan.json",
        HTTP_AUTHORIZATION=f"Bearer {raw_token}",
    )

    assert response.status_code == 200
    payload = json.loads(response.content.decode("utf-8"))
    assert payload["importacion_id"] == importacion.id
    assert payload["total_items"] == 1
