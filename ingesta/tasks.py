from __future__ import annotations

import hashlib
import logging
import zipfile
from io import BytesIO

from celery import shared_task
from django.db import transaction
from django.utils import timezone

from ingesta.models import ArchivoFactura, Factura, Importacion, Proveedor
from ingesta.services.parser_xml import parse_xml_bytes
from ingesta.services.s3_client import download_bytes, ensure_bucket, upload_xml

logger = logging.getLogger(__name__)


@shared_task
def process_zip_import(importacion_id: int) -> None:
    try:
        importacion = Importacion.objects.get(id=importacion_id)
    except Importacion.DoesNotExist:
        logger.error("Importacion %s no existe", importacion_id)
        return

    importacion.status = Importacion.Status.RUNNING
    importacion.started_at = timezone.now()
    importacion.save(update_fields=["status", "started_at"])

    file_logs: list[dict] = []
    total_archivos = 0
    total_facturas = 0
    total_proveedores = 0
    error_count = 0

    try:
        ensure_bucket()
        zip_bytes = download_bytes(importacion.s3_key_zip)
        with zipfile.ZipFile(BytesIO(zip_bytes)) as zf:
            for info in zf.infolist():
                if info.is_dir():
                    continue
                if not info.filename.lower().endswith(".xml"):
                    continue

                total_archivos += 1
                file_errors: list[str] = []
                try:
                    xml_bytes = zf.read(info)
                    parsed, warnings = parse_xml_bytes(xml_bytes)
                except Exception as exc:
                    error_count += 1
                    file_errors.append(f"XML inválido: {exc}")
                    file_logs.append(
                        {
                            "filename": info.filename,
                            "warnings": [],
                            "errors": file_errors,
                        }
                    )
                    continue

                if not parsed.ruc:
                    error_count += 1
                    file_errors.append("Falta RUC")
                if not parsed.clave_acceso:
                    error_count += 1
                    file_errors.append("Falta clave de acceso")

                if file_errors:
                    file_logs.append(
                        {
                            "filename": info.filename,
                            "warnings": warnings,
                            "errors": file_errors,
                        }
                    )
                    continue

                with transaction.atomic():
                    proveedor, created = Proveedor.objects.get_or_create(
                        ruc=parsed.ruc,
                        defaults={"razon_social": parsed.razon_social},
                    )
                    if created:
                        total_proveedores += 1
                    elif parsed.razon_social and not proveedor.razon_social:
                        proveedor.razon_social = parsed.razon_social
                        proveedor.save(update_fields=["razon_social"])

                    factura, created_factura = Factura.objects.get_or_create(
                        clave_acceso=parsed.clave_acceso,
                        defaults={
                            "proveedor": proveedor,
                            "fecha_emision": parsed.fecha_emision,
                            "total": parsed.total,
                            "subtotal": parsed.subtotal,
                            "iva": parsed.iva,
                            "moneda": parsed.moneda or "USD",
                        },
                    )
                    if created_factura:
                        total_facturas += 1
                    else:
                        updated = False
                        if factura.proveedor_id != proveedor.id:
                            factura.proveedor = proveedor
                            updated = True
                        if parsed.fecha_emision and factura.fecha_emision != parsed.fecha_emision:
                            factura.fecha_emision = parsed.fecha_emision
                            updated = True
                        if parsed.total is not None and factura.total != parsed.total:
                            factura.total = parsed.total
                            updated = True
                        if parsed.subtotal is not None and factura.subtotal != parsed.subtotal:
                            factura.subtotal = parsed.subtotal
                            updated = True
                        if parsed.iva is not None and factura.iva != parsed.iva:
                            factura.iva = parsed.iva
                            updated = True
                        if parsed.moneda and factura.moneda != parsed.moneda:
                            factura.moneda = parsed.moneda
                            updated = True
                        if updated:
                            factura.save()

                    xml_key = f"{parsed.ruc}/{parsed.clave_acceso}.xml"
                    upload_xml(xml_bytes, xml_key)
                    xml_sha = hashlib.sha256(xml_bytes).hexdigest()
                    ArchivoFactura.objects.update_or_create(
                        factura=factura,
                        defaults={"s3_key_xml": xml_key, "sha256_xml": xml_sha},
                    )

                file_logs.append(
                    {
                        "filename": info.filename,
                        "warnings": warnings,
                        "errors": [],
                    }
                )

        error_summary = "; ".join(
            entry["errors"][0] for entry in file_logs if entry["errors"]
        )
        importacion.status = Importacion.Status.DONE
        importacion.finished_at = timezone.now()
        importacion.total_archivos = total_archivos
        importacion.total_facturas = total_facturas
        importacion.total_proveedores = total_proveedores
        importacion.error_count = error_count
        importacion.error_summary = error_summary
        importacion.log_json = {"files": file_logs}
        importacion.save()
    except Exception as exc:
        logger.exception("Fallo importacion %s", importacion_id)
        importacion.status = Importacion.Status.FAILED
        importacion.finished_at = timezone.now()
        importacion.error_count = error_count + 1
        importacion.error_summary = str(exc)
        importacion.log_json = {"files": file_logs, "fatal": str(exc)}
        importacion.save()
