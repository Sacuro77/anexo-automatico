import logging
import re

from django.utils import timezone

from ingesta.models import (
    ArchivoFactura,
    AsignacionClasificacionFactura,
    Factura,
)

logger = logging.getLogger(__name__)
RUC_RE = re.compile(r"^\d{13}$")


def _build_proveedor_ruc(factura: Factura) -> str:
    raw_ruc = None
    for attr in ("ruc_emisor", "emisor_ruc", "proveedor_ruc"):
        value = getattr(factura, attr, None)
        if value:
            raw_ruc = value
            break
    if not raw_ruc and factura.proveedor_id:
        raw_ruc = factura.proveedor.ruc
    ruc = str(raw_ruc).strip() if raw_ruc is not None else ""
    if not ruc:
        return ""
    if not RUC_RE.match(ruc):
        logger.warning(
            "Factura %s has invalid proveedor_ruc: %s",
            factura.id,
            ruc,
        )
        return ""
    return ruc


def build_plan_payload(importacion, max_facturas=50):
    file_logs = (importacion.log_json or {}).get("files", [])
    factura_ids: list[int] = []
    factura_seen: set[int] = set()
    for entry in file_logs:
        factura_id = entry.get("factura_id")
        if factura_id and factura_id not in factura_seen:
            factura_ids.append(factura_id)
            factura_seen.add(factura_id)
    if not factura_ids:
        s3_keys: list[str] = []
        for entry in file_logs:
            key = entry.get("s3_key_xml") or entry.get("s3_key")
            if key:
                s3_keys.append(key)
        if s3_keys:
            factura_ids = list(
                ArchivoFactura.objects.filter(s3_key_xml__in=s3_keys)
                .values_list("factura_id", flat=True)
                .distinct()
            )
    factura_ids = factura_ids[:max_facturas]
    facturas = (
        Factura.objects.filter(id__in=factura_ids)
        .select_related("proveedor")
        .order_by()
    )
    facturas_by_id = {factura.id: factura for factura in facturas}
    asignaciones = (
        AsignacionClasificacionFactura.objects.filter(factura_id__in=factura_ids)
        .select_related("categoria_sugerida")
        .order_by()
    )
    asignaciones_by_id = {asignacion.factura_id: asignacion for asignacion in asignaciones}
    acciones: list[dict[str, object]] = []
    for factura_id in factura_ids:
        factura = facturas_by_id.get(factura_id)
        if not factura:
            continue
        asignacion = asignaciones_by_id.get(factura_id)
        if not asignacion or not asignacion.categoria_sugerida:
            continue
        proveedor_ruc = _build_proveedor_ruc(factura)
        acciones.append(
            {
                "proveedor_id": factura.proveedor_id,
                "proveedor_ruc": proveedor_ruc,
                "factura_id": factura.id,
                "clave_acceso": factura.clave_acceso,
                "categoria_id": asignacion.categoria_sugerida_id,
                "categoria_nombre": asignacion.categoria_sugerida.nombre,
                "confianza": asignacion.confianza,
            }
        )
    return {
        "importacion_id": importacion.id,
        "generated_at": timezone.now().isoformat(),
        "factura_limit": max_facturas,
        "total_items": len(acciones),
        "acciones": acciones,
    }
