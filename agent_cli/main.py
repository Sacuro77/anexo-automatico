import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone


def _load_requests():
    try:
        import requests  # type: ignore
    except ImportError:
        print(
            "Missing dependency: requests. Install with `pip install -r agent_cli/requirements.txt`."
        )
        sys.exit(2)
    return requests


def _print_help():
    print("Missing required env vars.")
    print("Required: AGENT_BASE_URL, AGENT_TOKEN, IMPORTACION_ID")
    print("Optional: AGENT_DRY_RUN=1")
    print("Example (PowerShell):")
    print('$env:AGENT_BASE_URL="http://localhost:8000"')
    print('$env:AGENT_TOKEN="TOKEN_DEL_SAAS"')
    print('$env:IMPORTACION_ID="1"')
    print("python agent_cli/main.py")


def load_env():
    base_url = os.getenv("AGENT_BASE_URL", "").strip()
    token = os.getenv("AGENT_TOKEN", "").strip()
    importacion_id_raw = os.getenv("IMPORTACION_ID", "").strip()
    dry_run_raw = os.getenv("AGENT_DRY_RUN", "").strip().lower()
    dry_run = dry_run_raw in {"1", "true", "yes", "y"}

    if not base_url or not token or not importacion_id_raw:
        _print_help()
        sys.exit(2)

    try:
        importacion_id = int(importacion_id_raw)
    except ValueError:
        print("IMPORTACION_ID must be an integer.")
        sys.exit(2)

    return {
        "base_url": base_url.rstrip("/"),
        "token": token,
        "importacion_id": importacion_id,
        "dry_run": dry_run,
    }


def _request(requests, method: str, url: str, headers: dict, payload=None):
    try:
        return requests.request(
            method,
            url,
            headers=headers,
            json=payload,
            timeout=15,
        )
    except requests.RequestException as exc:
        print(f"Request failed: {exc}")
        sys.exit(1)


def _parse_json_or_exit(response):
    if not response.text:
        return None
    try:
        return response.json()
    except ValueError:
        print("Response was not JSON.")
        sys.exit(1)


def api_get_me(requests, base_url: str, headers: dict):
    url = f"{base_url}/api/agent/me"
    response = _request(requests, "GET", url, headers=headers)
    if response.status_code == 401:
        print("Token inválido o expirado.")
        sys.exit(1)
    if response.status_code >= 400:
        print(f"Error {response.status_code} for GET {url}")
        print(response.text)
        sys.exit(1)
    return _parse_json_or_exit(response)


def api_get_plan(requests, base_url: str, importacion_id: int, headers: dict):
    url = f"{base_url}/api/agent/importaciones/{importacion_id}/plan.json"
    response = _request(requests, "GET", url, headers=headers)
    if response.status_code == 403:
        print("Token sin acceso a esta importación.")
        sys.exit(1)
    if response.status_code == 401:
        print("Token inválido o expirado.")
        sys.exit(1)
    if response.status_code >= 400:
        print(f"Error {response.status_code} for GET {url}")
        print(response.text)
        sys.exit(1)
    return _parse_json_or_exit(response)


def api_post_event(
    requests,
    base_url: str,
    headers: dict,
    payload: dict,
    dry_run: bool,
):
    if dry_run:
        print(f"[dry-run] event {payload.get('step')}:{payload.get('status')}")
        return
    url = f"{base_url}/api/agent/events"
    response = _request(requests, "POST", url, headers=headers, payload=payload)
    if response.status_code >= 400:
        print(f"Error {response.status_code} for POST {url}")
        print(response.text)
        sys.exit(1)


def group_by_provider(acciones):
    grouped = defaultdict(list)
    for accion in acciones:
        provider_id = accion.get("proveedor_id") or "UNKNOWN"
        grouped[provider_id].append(accion)
    return grouped


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def run_assisted_flow(config, plan, requests):
    acciones = plan.get("acciones", [])
    total_items = plan.get("total_items", 0)
    print(
        "Plan:",
        f"importacion_id={plan.get('importacion_id')}",
        f"total_items={total_items}",
    )

    if not total_items:
        print("No hay acciones para aplicar.")
        return 0

    headers = {
        "Authorization": f"Bearer {config['token']}",
        "Content-Type": "application/json",
    }
    base_url = config["base_url"]
    importacion_id = config["importacion_id"]
    dry_run = config["dry_run"]

    api_post_event(
        requests,
        base_url,
        headers,
        {
            "importacion_id": importacion_id,
            "step": "plan_fetch",
            "status": "ok",
            "message": f"Plan con {total_items} acciones.",
            "ts": _now_iso(),
        },
        dry_run,
    )

    grouped = group_by_provider(acciones)
    for provider_id, items in grouped.items():
        categorias = {item.get("categoria_id") for item in items}
        categoria_nombre = {item.get("categoria_nombre") for item in items}
        confidencias = {item.get("confianza") for item in items}
        same_categoria = len(categorias) == 1
        same_nombre = len(categoria_nombre) == 1
        all_high = confidencias == {"HIGH"}
        allow_apply_all = same_categoria and all_high

        if same_nombre:
            categoria_label = next(iter(categoria_nombre))
        else:
            categoria_label = "MIXTO"

        print(
            f"\nProveedor {provider_id}: {len(items)} facturas | Categoria: {categoria_label}"
        )
        if categoria_label == "MIXTO":
            for item in items:
                print(
                    f" - factura_id={item.get('factura_id')} "
                    f"clave={item.get('clave_acceso')} "
                    f"categoria={item.get('categoria_nombre')} "
                    f"confianza={item.get('confianza')}"
                )

        api_post_event(
            requests,
            base_url,
            headers,
            {
                "importacion_id": importacion_id,
                "step": "provider_start",
                "status": "ok",
                "message": f"Proveedor {provider_id} ({len(items)} facturas).",
                "ts": _now_iso(),
            },
            dry_run,
        )

        if allow_apply_all:
            answer = input("Aplicar todas las facturas? [a/N]: ").strip().lower()
            if answer == "a":
                for item in items:
                    factura_id = item.get("factura_id")
                    if not factura_id:
                        continue
                    api_post_event(
                        requests,
                        base_url,
                        headers,
                        {
                            "importacion_id": importacion_id,
                            "factura_id": factura_id,
                            "step": "apply",
                            "status": "ok",
                            "message": "Aplicado en lote.",
                            "ts": _now_iso(),
                        },
                        dry_run,
                    )
                print("Aplicadas todas las facturas del proveedor.")
                api_post_event(
                    requests,
                    base_url,
                    headers,
                    {
                        "importacion_id": importacion_id,
                        "step": "provider_done",
                        "status": "ok",
                        "message": f"Proveedor {provider_id} completado.",
                        "ts": _now_iso(),
                    },
                    dry_run,
                )
                continue

        for item in items:
            factura_id = item.get("factura_id")
            clave = item.get("clave_acceso")
            categoria = item.get("categoria_nombre")
            print(
                f"Factura {factura_id} clave={clave} categoria={categoria} "
                f"confianza={item.get('confianza')}"
            )
            answer = input("Aplicar? [y/N]: ").strip().lower()
            if answer == "y":
                api_post_event(
                    requests,
                    base_url,
                    headers,
                    {
                        "importacion_id": importacion_id,
                        "factura_id": factura_id,
                        "step": "apply",
                        "status": "ok",
                        "message": f"Categoria {categoria} aplicada (simulado).",
                        "ts": _now_iso(),
                    },
                    dry_run,
                )
            else:
                api_post_event(
                    requests,
                    base_url,
                    headers,
                    {
                        "importacion_id": importacion_id,
                        "factura_id": factura_id,
                        "step": "skip",
                        "status": "skipped",
                        "message": "Factura omitida por operador.",
                        "ts": _now_iso(),
                    },
                    dry_run,
                )

        api_post_event(
            requests,
            base_url,
            headers,
            {
                "importacion_id": importacion_id,
                "step": "provider_done",
                "status": "ok",
                "message": f"Proveedor {provider_id} completado.",
                "ts": _now_iso(),
            },
            dry_run,
        )

    return 0


def main():
    requests = _load_requests()
    config = load_env()

    headers = {
        "Authorization": f"Bearer {config['token']}",
        "Content-Type": "application/json",
    }

    me = api_get_me(requests, config["base_url"], headers)
    print(f"Token OK. Expires: {me.get('expires_at')}")

    plan = api_get_plan(
        requests,
        config["base_url"],
        config["importacion_id"],
        headers,
    )

    exit_code = run_assisted_flow(config, plan, requests)
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
