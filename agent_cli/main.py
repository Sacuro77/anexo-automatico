import json
import os
import sys


def _require_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        print(f"Missing required env var: {name}")
        sys.exit(2)
    return value


def _load_requests():
    try:
        import requests  # type: ignore
    except ImportError:
        print("Missing dependency: requests. Install with `pip install -r agent_cli/requirements.txt`.")
        sys.exit(2)
    return requests


def _request_json(requests, method: str, url: str, headers: dict, payload=None):
    try:
        response = requests.request(
            method,
            url,
            headers=headers,
            json=payload,
            timeout=20,
        )
    except requests.RequestException as exc:
        print(f"Request failed: {exc}")
        sys.exit(1)

    if response.status_code >= 400:
        print(f"Error {response.status_code} for {method} {url}")
        try:
            print(json.dumps(response.json(), indent=2, ensure_ascii=False))
        except ValueError:
            print(response.text)
        sys.exit(1)

    if not response.text:
        return None
    try:
        return response.json()
    except ValueError:
        print("Response was not JSON.")
        sys.exit(1)


def main():
    requests = _load_requests()

    base_url = os.getenv("ANEXO_BASE_URL", "http://localhost:8000").rstrip("/")
    token = _require_env("AGENT_TOKEN")
    importacion_id = _require_env("IMPORTACION_ID")

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    me_url = f"{base_url}/api/agent/me"
    me = _request_json(requests, "GET", me_url, headers=headers)
    print(f"Token OK. Expires: {me.get('expires_at')}")

    plan_url = f"{base_url}/api/agent/importaciones/{importacion_id}/plan.json"
    plan = _request_json(requests, "GET", plan_url, headers=headers)
    acciones = plan.get("acciones", [])

    print(
        "Plan:",
        f"importacion_id={plan.get('importacion_id')}",
        f"total_items={plan.get('total_items')}",
    )

    if not acciones:
        print("No hay acciones para aplicar.")
        return

    total = len(acciones)
    for idx, accion in enumerate(acciones, start=1):
        factura_id = accion.get("factura_id")
        clave = accion.get("clave_acceso")
        categoria = accion.get("categoria_nombre")
        print(
            f"[{idx}/{total}] factura_id={factura_id} clave={clave} categoria={categoria}"
        )
        answer = input("Aplicar categoria? [y/N]: ").strip().lower()
        if answer != "y":
            continue

        base_payload = {
            "importacion_id": int(importacion_id),
            "factura_id": factura_id,
            "step": "apply_category",
        }
        pending_payload = {
            **base_payload,
            "status": "pending",
            "message": f"Aplicando categoria {categoria} a {clave}",
        }
        ok_payload = {
            **base_payload,
            "status": "ok",
            "message": f"Categoria {categoria} aplicada (simulado).",
        }

        events_url = f"{base_url}/api/agent/events"
        _request_json(requests, "POST", events_url, headers=headers, payload=pending_payload)
        _request_json(requests, "POST", events_url, headers=headers, payload=ok_payload)
        print("Evento ok registrado.")


if __name__ == "__main__":
    main()
