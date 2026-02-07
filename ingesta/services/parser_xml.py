from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Iterable
from xml.etree import ElementTree


@dataclass
class ParsedFactura:
    ruc: str | None
    razon_social: str | None
    clave_acceso: str | None
    fecha_emision: datetime.date | None
    total: Decimal | None
    subtotal: Decimal | None
    iva: Decimal | None
    moneda: str | None


def _normalize_tag(tag: str) -> str:
    if "}" in tag:
        return tag.split("}", 1)[1].lower()
    return tag.lower()


def _find_first_text(root: ElementTree.Element, names: Iterable[str]) -> str | None:
    candidates = {name.lower() for name in names}
    for elem in root.iter():
        tag = _normalize_tag(elem.tag)
        if tag in candidates and elem.text:
            value = elem.text.strip()
            if value:
                return value
    return None


def _parse_decimal(value: str | None) -> Decimal | None:
    if not value:
        return None
    cleaned = value.strip().replace(" ", "")
    if cleaned.count(",") == 1 and cleaned.count(".") == 0:
        cleaned = cleaned.replace(",", ".")
    cleaned = cleaned.replace(",", "")
    try:
        return Decimal(cleaned)
    except (InvalidOperation, ValueError):
        return None


def _parse_date(value: str | None) -> datetime.date | None:
    if not value:
        return None
    cleaned = value.strip()
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(cleaned, fmt).date()
        except ValueError:
            continue
    return None


def _find_iva(root: ElementTree.Element) -> str | None:
    for elem in root.iter():
        if _normalize_tag(elem.tag) == "totalimpuesto":
            for child in elem.iter():
                if _normalize_tag(child.tag) == "valor" and child.text:
                    value = child.text.strip()
                    if value:
                        return value
    return None


def parse_xml_bytes(xml_bytes: bytes) -> tuple[ParsedFactura, list[str]]:
    warnings: list[str] = []
    root = ElementTree.fromstring(xml_bytes)

    ruc = _find_first_text(root, ["ruc", "rucemisor", "ruccomprador"])
    if not ruc:
        warnings.append("No se encontró RUC")

    razon_social = _find_first_text(
        root, ["razonsocial", "razonsocialcomprador", "razonsocialemisor"]
    )
    if not razon_social:
        warnings.append("No se encontró razón social")

    clave = _find_first_text(root, ["claveacceso", "clave"])
    if not clave:
        warnings.append("No se encontró clave de acceso")

    fecha_emision_raw = _find_first_text(root, ["fechaemision", "fecha"])
    fecha_emision = _parse_date(fecha_emision_raw)
    if fecha_emision_raw and not fecha_emision:
        warnings.append("No se pudo parsear fecha de emisión")
    if not fecha_emision_raw:
        warnings.append("No se encontró fecha de emisión")

    subtotal_raw = _find_first_text(root, ["totalsinimpuestos", "subtotal"])
    subtotal = _parse_decimal(subtotal_raw)
    if subtotal_raw and subtotal is None:
        warnings.append("No se pudo parsear subtotal")

    total_raw = _find_first_text(root, ["importetotal", "total"])
    total = _parse_decimal(total_raw)
    if total_raw and total is None:
        warnings.append("No se pudo parsear total")

    iva_raw = _find_first_text(root, ["iva"])
    if not iva_raw:
        iva_raw = _find_iva(root)
    iva = _parse_decimal(iva_raw)
    if iva_raw and iva is None:
        warnings.append("No se pudo parsear IVA")

    moneda = _find_first_text(root, ["moneda"])

    return (
        ParsedFactura(
            ruc=ruc,
            razon_social=razon_social,
            clave_acceso=clave,
            fecha_emision=fecha_emision,
            total=total,
            subtotal=subtotal,
            iva=iva,
            moneda=moneda,
        ),
        warnings,
    )
