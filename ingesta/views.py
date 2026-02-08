import csv
import json

from django.contrib import messages
from django.db.models import Count, F, Q, Value
from django.db.models.functions import Coalesce
from django.http import HttpResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone
from django.views.decorators.http import require_http_methods

from ingesta.forms import ImportacionUploadForm
from ingesta.models import (
    ArchivoFactura,
    AsignacionClasificacionFactura,
    Confianza,
    Factura,
    Importacion,
)
from ingesta.services.s3_client import ensure_bucket, upload_zip
from ingesta.services.plan import build_plan_payload
from ingesta.tasks import process_zip_import


@require_http_methods(["GET", "POST"])
def index(request):
    if request.method == "POST":
        form = ImportacionUploadForm(request.POST, request.FILES)
        if form.is_valid():
            importacion = Importacion.objects.create()
            key = f"imports/{importacion.id}/source.zip"
            try:
                ensure_bucket()
                uploaded = form.cleaned_data["archivo"]
                uploaded.seek(0)
                upload_zip(uploaded, key)
            except Exception as exc:
                importacion.status = Importacion.Status.FAILED
                importacion.finished_at = timezone.now()
                importacion.error_count = 1
                importacion.error_summary = str(exc)
                importacion.save()
                messages.error(request, "No se pudo subir el ZIP.")
                return redirect("ingesta-detail", importacion_id=importacion.id)

            importacion.s3_key_zip = key
            importacion.save(update_fields=["s3_key_zip"])
            process_zip_import.delay(importacion.id)
            messages.success(request, "Importación encolada.")
            return redirect("ingesta-detail", importacion_id=importacion.id)
    else:
        form = ImportacionUploadForm()

    importaciones = Importacion.objects.order_by("-created_at")[:20]
    return render(
        request,
        "ingesta/index.html",
        {"form": form, "importaciones": importaciones},
    )


def importacion_list(request):
    importaciones = Importacion.objects.order_by("-created_at")
    return render(
        request,
        "ingesta/list.html",
        {"importaciones": importaciones},
    )


def importacion_detail(request, importacion_id: int):
    importacion = get_object_or_404(Importacion, id=importacion_id)
    file_logs = (importacion.log_json or {}).get("files", [])
    factura_ids: list[int] = []
    factura_seen: set[int] = set()
    for entry in file_logs:
        factura_id = entry.get("factura_id")
        if factura_id and factura_id not in factura_seen:
            factura_ids.append(factura_id)
            factura_seen.add(factura_id)
    fallback_message = ""
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
        if not factura_ids:
            fallback_message = (
                "Esta importación no contiene referencia a facturas (importación antigua). "
                "Reimporta el ZIP para ver sugerencias."
            )
    max_facturas = 50
    total_facturas = len(factura_ids)
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
    resumen_por_categoria = list(
        AsignacionClasificacionFactura.objects.filter(factura_id__in=factura_ids)
        .annotate(
            nombre_categoria=Coalesce(
                F("categoria_sugerida__nombre"),
                Value("Sin categoría"),
            )
        )
        .values("nombre_categoria")
        .annotate(count=Count("id"))
        .order_by("-count", "nombre_categoria")
    )
    asignaciones_by_id = {asignacion.factura_id: asignacion for asignacion in asignaciones}
    factura_sugerencias = []
    for factura_id in factura_ids:
        factura = facturas_by_id.get(factura_id)
        if not factura:
            continue
        factura_sugerencias.append(
            {
                "factura": factura,
                "asignacion": asignaciones_by_id.get(factura_id),
            }
        )
    return render(
        request,
        "ingesta/detail.html",
        {
            "importacion": importacion,
            "factura_sugerencias": factura_sugerencias,
            "factura_limit": max_facturas,
            "factura_total": total_facturas,
            "fallback_message": fallback_message,
            "resumen_por_categoria": resumen_por_categoria,
        },
    )


def importacion_export_csv(request, importacion_id: int):
    importacion = get_object_or_404(Importacion, id=importacion_id)
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
    max_facturas = 50
    factura_ids = factura_ids[:max_facturas]
    facturas = (
        Factura.objects.filter(id__in=factura_ids)
        .select_related("proveedor")
        .order_by()
    )
    facturas_by_id = {factura.id: factura for factura in facturas}
    asignaciones = (
        AsignacionClasificacionFactura.objects.filter(factura_id__in=factura_ids)
        .select_related("factura__proveedor", "categoria_sugerida")
        .order_by()
    )
    asignaciones_by_id = {asignacion.factura_id: asignacion for asignacion in asignaciones}
    response = HttpResponse(content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = (
        f'attachment; filename="importacion-{importacion.id}-checklist.csv"'
    )
    writer = csv.writer(response)
    writer.writerow(
        ["ruc", "razon_social", "clave_acceso", "categoria_sugerida", "confianza"]
    )
    for factura_id in factura_ids:
        factura = facturas_by_id.get(factura_id)
        if not factura:
            continue
        asignacion = asignaciones_by_id.get(factura_id)
        categoria = "Sin categoría"
        if asignacion and asignacion.categoria_sugerida:
            categoria = asignacion.categoria_sugerida.nombre
        confianza = "-"
        if asignacion and asignacion.confianza:
            confianza = asignacion.confianza
        writer.writerow(
            [
                factura.proveedor.ruc,
                factura.proveedor.razon_social or "",
                factura.clave_acceso,
                categoria,
                confianza,
            ]
        )
    return response


def importacion_export_plan_json(request, importacion_id: int):
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


def revisar(request):
    query = request.GET.get("q", "").strip()
    base_filter = Q(categoria_sugerida__isnull=True) | Q(confianza=Confianza.LOW)
    asignaciones = AsignacionClasificacionFactura.objects.select_related(
        "factura",
        "factura__proveedor",
        "categoria_sugerida",
    ).filter(base_filter)
    if query:
        asignaciones = asignaciones.filter(
            Q(factura__clave_acceso__icontains=query)
            | Q(factura__proveedor__ruc__icontains=query)
            | Q(factura__proveedor__razon_social__icontains=query)
        )
    asignaciones = asignaciones.order_by("-updated_at")[:200]
    return render(
        request,
        "ingesta/review.html",
        {"asignaciones": asignaciones, "query": query},
    )
