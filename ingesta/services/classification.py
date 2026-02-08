from __future__ import annotations

from typing import Iterable

from ingesta.models import (
    AsignacionClasificacionFactura,
    Categoria,
    Confianza,
    Factura,
    ReglaClasificacion,
)


def _build_text(parts: Iterable[str | None]) -> str:
    cleaned = [part.strip() for part in parts if part and part.strip()]
    return " ".join(cleaned)


def classify_factura(
    factura: Factura,
) -> tuple[Categoria | None, str, list[str]]:
    proveedor = factura.proveedor
    razones: list[str] = []

    ruc = (proveedor.ruc or "").strip() if proveedor else ""
    if ruc:
        regla_ruc = (
            ReglaClasificacion.objects.filter(
                activo=True,
                tipo=ReglaClasificacion.Tipo.RUC,
                patron__iexact=ruc,
            )
            .select_related("categoria")
            .order_by("prioridad", "id")
            .first()
        )
        if regla_ruc:
            razones.append(f"RUC match {ruc}")
            return regla_ruc.categoria, regla_ruc.confianza_base, razones

    texto = _build_text([proveedor.razon_social if proveedor else None, factura.clave_acceso])
    texto_upper = texto.upper()
    if texto_upper:
        reglas = (
            ReglaClasificacion.objects.filter(
                activo=True,
                tipo=ReglaClasificacion.Tipo.KEYWORD,
            )
            .select_related("categoria")
            .order_by("prioridad", "id")
        )
        for regla in reglas:
            patron = regla.patron.strip()
            if not patron:
                continue
            if patron.upper() in texto_upper:
                razones.append(f"Keyword '{patron}' matched")
                return regla.categoria, regla.confianza_base, razones

    razones.append("Sin reglas aplicables")
    return None, Confianza.LOW, razones


def upsert_asignacion_factura(
    factura: Factura,
    categoria,
    confianza: str,
    razones: list[str] | None,
    metodo: str = AsignacionClasificacionFactura.Metodo.AUTO,
) -> AsignacionClasificacionFactura:
    return AsignacionClasificacionFactura.objects.update_or_create(
        factura=factura,
        defaults={
            "categoria_sugerida": categoria,
            "confianza": confianza,
            "razones": razones or [],
            "metodo": metodo,
        },
    )[0]
