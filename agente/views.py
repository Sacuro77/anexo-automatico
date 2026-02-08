import hashlib
import json
import secrets
from datetime import timedelta

from django.contrib.auth.decorators import login_required
from django.http import HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404, render
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from agente.models import AgentEvent, AgentToken
from ingesta.models import Importacion
from ingesta.services.plan import build_plan_payload


def _hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def _get_bearer_token(request):
    header = request.META.get("HTTP_AUTHORIZATION", "")
    if not header.startswith("Bearer "):
        return None
    return header.replace("Bearer ", "", 1).strip() or None


def _parse_json(request):
    if not request.body:
        return {}
    try:
        return json.loads(request.body.decode("utf-8"))
    except json.JSONDecodeError:
        return None


def _unauthorized(message="Token inválido"):
    return JsonResponse({"detail": message}, status=401)


def _get_valid_token(request):
    raw_token = _get_bearer_token(request)
    if not raw_token:
        return None
    token_hash = _hash_token(raw_token)
    token = AgentToken.objects.filter(token_hash=token_hash).first()
    if not token or token.is_revoked() or token.is_expired():
        return None
    token.last_seen_at = timezone.now()
    token.save(update_fields=["last_seen_at"])
    return token


def _create_token(*, user, allowed_importacion=None, name=""):
    for _ in range(5):
        raw_token = secrets.token_urlsafe(32)
        token_hash = _hash_token(raw_token)
        if not AgentToken.objects.filter(token_hash=token_hash).exists():
            break
    else:
        raise RuntimeError("No se pudo generar token único.")
    expires_at = timezone.now() + timedelta(hours=24)
    token = AgentToken.objects.create(
        token_hash=token_hash,
        user=user,
        allowed_importacion=allowed_importacion,
        name=name or "",
        expires_at=expires_at,
    )
    return raw_token, token


@login_required
@require_http_methods(["POST"])
def create_token_api(request):
    payload = _parse_json(request)
    if payload is None:
        return JsonResponse({"detail": "JSON inválido"}, status=400)
    allowed_importacion_id = (
        (payload or {}).get("allowed_importacion_id")
        or request.POST.get("allowed_importacion_id")
    )
    name = (payload or {}).get("name") or request.POST.get("name") or ""
    allowed_importacion = None
    if allowed_importacion_id:
        allowed_importacion = get_object_or_404(Importacion, id=allowed_importacion_id)
    raw_token, token = _create_token(
        user=request.user,
        allowed_importacion=allowed_importacion,
        name=name,
    )
    return JsonResponse(
        {
            "token": raw_token,
            "expires_at": token.expires_at.isoformat(),
        }
    )


@require_http_methods(["GET"])
def agent_me(request):
    token = _get_valid_token(request)
    if not token:
        return _unauthorized()
    return JsonResponse(
        {
            "ok": True,
            "expires_at": token.expires_at.isoformat(),
            "allowed_importacion_id": token.allowed_importacion_id,
        }
    )


@require_http_methods(["GET"])
def agent_plan_json(request, importacion_id: int):
    token = _get_valid_token(request)
    if not token:
        return _unauthorized()
    if not token.allows_importacion(importacion_id):
        return JsonResponse({"detail": "Token sin acceso"}, status=403)
    importacion = get_object_or_404(Importacion, id=importacion_id)
    payload = build_plan_payload(importacion)
    response = HttpResponse(
        json.dumps(payload, ensure_ascii=False),
        content_type="application/json; charset=utf-8",
    )
    response["Content-Disposition"] = (
        f'attachment; filename="importacion-{importacion.id}-plan.json"'
    )
    return response


@csrf_exempt
@require_http_methods(["POST"])
def agent_events(request):
    token = _get_valid_token(request)
    if not token:
        return _unauthorized()
    payload = _parse_json(request)
    if payload is None:
        return JsonResponse({"detail": "JSON inválido"}, status=400)
    importacion_id = (payload or {}).get("importacion_id")
    step = (payload or {}).get("step")
    status = (payload or {}).get("status")
    if not importacion_id or not step or not status:
        return JsonResponse({"detail": "Faltan campos requeridos"}, status=400)
    importacion = get_object_or_404(Importacion, id=importacion_id)
    if not token.allows_importacion(importacion.id):
        return JsonResponse({"detail": "Token sin acceso"}, status=403)
    event_ts = None
    if (payload or {}).get("ts"):
        event_ts = parse_datetime(payload["ts"])
    AgentEvent.objects.create(
        token=token,
        importacion=importacion,
        factura_id=(payload or {}).get("factura_id"),
        step=step,
        status=status,
        message=(payload or {}).get("message") or "",
        event_ts=event_ts,
    )
    return JsonResponse({"ok": True}, status=201)


@login_required
@require_http_methods(["POST"])
def generate_importacion_token(request, importacion_id: int):
    importacion = get_object_or_404(Importacion, id=importacion_id)
    raw_token, token = _create_token(
        user=request.user,
        allowed_importacion=importacion,
        name=f"Importacion {importacion.id}",
    )
    return render(
        request,
        "agente/token.html",
        {
            "importacion": importacion,
            "token": raw_token,
            "expires_at": token.expires_at,
        },
    )
