import io
import re
import zipfile

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import IntegrityError, transaction

from ingesta.models import (
    ArchivoFactura,
    AsignacionClasificacionFactura,
    Categoria,
    Confianza,
    Factura,
    Importacion,
    Proveedor,
    ReglaClasificacion,
)
from ingesta.services.parser_xml import parse_xml_bytes
from ingesta.tasks import process_zip_import


def _build_zip_bytes() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as zf:
        zf.writestr("factura.xml", "<factura></factura>")
    return buffer.getvalue()


@pytest.mark.django_db
def test_ingesta_post_crea_importacion_y_encola(client, monkeypatch):
    called = {}

    def fake_delay(importacion_id):
        called["id"] = importacion_id

    monkeypatch.setattr(
        "ingesta.views.process_zip_import.delay",
        fake_delay,
    )
    monkeypatch.setattr("ingesta.views.ensure_bucket", lambda: None)
    monkeypatch.setattr("ingesta.views.upload_zip", lambda *args, **kwargs: None)

    upload = SimpleUploadedFile(
        "facturas.zip",
        _build_zip_bytes(),
        content_type="application/zip",
    )
    response = client.post("/ingesta/", {"archivo": upload})

    assert response.status_code == 302
    assert Importacion.objects.count() == 1
    importacion = Importacion.objects.first()
    assert importacion is not None
    assert importacion.s3_key_zip == f"imports/{importacion.id}/source.zip"
    assert called["id"] == importacion.id


def test_parser_minimo():
    xml = """
    <factura>
      <infoTributaria>
        <ruc>1234567890</ruc>
        <razonSocial>Proveedor Demo</razonSocial>
        <claveAcceso>ABC123</claveAcceso>
      </infoTributaria>
      <infoFactura>
        <fechaEmision>01/01/2024</fechaEmision>
        <totalSinImpuestos>10.00</totalSinImpuestos>
        <importeTotal>11.20</importeTotal>
        <totalConImpuestos>
          <totalImpuesto>
            <valor>1.20</valor>
          </totalImpuesto>
        </totalConImpuestos>
      </infoFactura>
    </factura>
    """.strip().encode("utf-8")

    parsed, warnings = parse_xml_bytes(xml)

    assert parsed.ruc == "1234567890"
    assert parsed.razon_social == "Proveedor Demo"
    assert parsed.clave_acceso == "ABC123"
    assert str(parsed.fecha_emision) == "2024-01-01"
    assert str(parsed.subtotal) == "10.00"
    assert str(parsed.total) == "11.20"
    assert str(parsed.iva) == "1.20"
    assert "No se encontró RUC" not in warnings


def test_parser_autorizacion_wrapper():
    xml = """
    <autorizacion>
      <estado>AUTORIZADO</estado>
      <comprobante><![CDATA[
        <factura>
          <infoTributaria>
            <ruc>1790012345001</ruc>
            <razonSocial>Proveedor SRI</razonSocial>
            <claveAcceso>CLAVE-SRI-001</claveAcceso>
          </infoTributaria>
          <infoFactura>
            <fechaEmision>02/02/2024</fechaEmision>
          </infoFactura>
        </factura>
      ]]></comprobante>
    </autorizacion>
    """.strip().encode("utf-8")

    parsed, warnings = parse_xml_bytes(xml)

    assert parsed.ruc == "1790012345001"
    assert parsed.razon_social == "Proveedor SRI"
    assert parsed.clave_acceso == "CLAVE-SRI-001"
    assert str(parsed.fecha_emision) == "2024-02-02"
    assert "No se encontró comprobante en autorización" not in warnings


def test_parser_moneda_dolar_normaliza_usd():
    xml = """
    <factura>
      <infoTributaria>
        <ruc>0999999999</ruc>
        <razonSocial>Proveedor Moneda</razonSocial>
        <claveAcceso>MONEDA-001</claveAcceso>
      </infoTributaria>
      <infoFactura>
        <fechaEmision>03/03/2024</fechaEmision>
        <moneda>DOLAR</moneda>
      </infoFactura>
    </factura>
    """.strip().encode("utf-8")

    parsed, _warnings = parse_xml_bytes(xml)

    assert parsed.moneda == "USD"


def _build_zip_with_factura(ruc: str, clave: str, razon_social: str) -> bytes:
    xml = f"""
    <factura>
      <infoTributaria>
        <ruc>{ruc}</ruc>
        <razonSocial>{razon_social}</razonSocial>
        <claveAcceso>{clave}</claveAcceso>
      </infoTributaria>
      <infoFactura>
        <fechaEmision>01/01/2024</fechaEmision>
        <totalSinImpuestos>10.00</totalSinImpuestos>
        <importeTotal>11.20</importeTotal>
      </infoFactura>
    </factura>
    """.strip().encode("utf-8")
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as zf:
        zf.writestr("factura.xml", xml)
    return buffer.getvalue()


@pytest.mark.django_db
def test_constraints_unique():
    Proveedor.objects.create(ruc="999")
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            Proveedor.objects.create(ruc="999")

    proveedor = Proveedor.objects.create(ruc="888")
    Factura.objects.create(clave_acceso="CLAVE1", proveedor=proveedor)
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            Factura.objects.create(clave_acceso="CLAVE1", proveedor=proveedor)

    factura = Factura.objects.create(clave_acceso="CLAVE2", proveedor=proveedor)
    ArchivoFactura.objects.create(factura=factura, s3_key_xml="ruc/CLAVE2.xml")
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            otro = Factura.objects.create(clave_acceso="CLAVE3", proveedor=proveedor)
            ArchivoFactura.objects.create(
                factura=otro,
                s3_key_xml="ruc/CLAVE2.xml",
            )


@pytest.mark.django_db
def test_importacion_crea_asignacion_clasificacion(monkeypatch):
    categoria = Categoria.objects.create(nombre="Farmacia")
    ReglaClasificacion.objects.create(
        prioridad=1,
        tipo=ReglaClasificacion.Tipo.RUC,
        patron="1790012345001",
        categoria=categoria,
        confianza_base=Confianza.HIGH,
    )
    zip_bytes = _build_zip_with_factura(
        ruc="1790012345001",
        clave="CLAVE-IMPORT-001",
        razon_social="Farmacia Central",
    )
    importacion = Importacion.objects.create(s3_key_zip="imports/1/source.zip")

    monkeypatch.setattr("ingesta.tasks.ensure_bucket", lambda: None)
    monkeypatch.setattr("ingesta.tasks.download_bytes", lambda _key: zip_bytes)
    monkeypatch.setattr("ingesta.tasks.upload_xml", lambda *_args, **_kwargs: None)

    process_zip_import(importacion.id)

    assert AsignacionClasificacionFactura.objects.count() == 1
    asignacion = AsignacionClasificacionFactura.objects.select_related("categoria_sugerida").first()
    assert asignacion is not None
    assert asignacion.categoria_sugerida == categoria


@pytest.mark.django_db
def test_importacion_detail_muestra_sugerencias_con_factura_id(client):
    categoria = Categoria.objects.create(nombre="Servicios")
    proveedor = Proveedor.objects.create(ruc="123", razon_social="Proveedor Demo")
    factura = Factura.objects.create(proveedor=proveedor, clave_acceso="CLAVE-DET-1")
    AsignacionClasificacionFactura.objects.create(
        factura=factura,
        categoria_sugerida=categoria,
        confianza=Confianza.HIGH,
    )
    importacion = Importacion.objects.create(log_json={"files": [{"factura_id": factura.id}]})

    response = client.get(f"/ingesta/importaciones/{importacion.id}/")

    assert response.status_code == 200
    content = response.content.decode("utf-8")
    assert "CLAVE-DET-1" in content
    assert "Servicios" in content
    assert "HIGH" in content


@pytest.mark.django_db
def test_importacion_detail_muestra_fallback_sin_factura_id(client):
    importacion = Importacion.objects.create(log_json={"files": [{"filename": "factura.xml"}]})

    response = client.get(f"/ingesta/importaciones/{importacion.id}/")

    assert response.status_code == 200
    content = response.content.decode("utf-8")
    assert (
        "Esta importación no contiene referencia a facturas (importación antigua). "
        "Reimporta el ZIP para ver sugerencias."
    ) in content
    assert "Sin sugerencias aún." not in content


@pytest.mark.django_db
def test_importacion_detail_resumen_por_categoria(client):
    proveedor = Proveedor.objects.create(ruc="222", razon_social="Proveedor Dos")
    factura_uno = Factura.objects.create(proveedor=proveedor, clave_acceso="CLAVE-RES-1")
    factura_dos = Factura.objects.create(proveedor=proveedor, clave_acceso="CLAVE-RES-2")
    factura_tres = Factura.objects.create(proveedor=proveedor, clave_acceso="CLAVE-RES-3")
    categoria = Categoria.objects.create(nombre="SALUD")
    AsignacionClasificacionFactura.objects.create(
        factura=factura_uno,
        categoria_sugerida=categoria,
        confianza=Confianza.HIGH,
    )
    AsignacionClasificacionFactura.objects.create(
        factura=factura_dos,
        categoria_sugerida=categoria,
        confianza=Confianza.MEDIUM,
    )
    AsignacionClasificacionFactura.objects.create(
        factura=factura_tres,
        categoria_sugerida=None,
        confianza=Confianza.LOW,
    )
    importacion = Importacion.objects.create(
        log_json={
            "files": [
                {"factura_id": factura_uno.id},
                {"factura_id": factura_dos.id},
                {"factura_id": factura_tres.id},
            ]
        }
    )

    response = client.get(f"/ingesta/importaciones/{importacion.id}/")

    assert response.status_code == 200
    content = response.content.decode("utf-8")
    assert "Resumen por categoría" in content
    assert re.search(r"SALUD\s*</td>\s*<td[^>]*>\s*2\s*</td>", content)
    assert re.search(r"Sin categoría\s*</td>\s*<td[^>]*>\s*1\s*</td>", content)


@pytest.mark.django_db
def test_revisar_incluye_low_o_sin_categoria(client):
    categoria = Categoria.objects.create(nombre="Servicios")
    proveedor = Proveedor.objects.create(ruc="555", razon_social="Proveedor Uno")
    factura_low = Factura.objects.create(proveedor=proveedor, clave_acceso="CLAVE-LOW-1")
    factura_none = Factura.objects.create(proveedor=proveedor, clave_acceso="CLAVE-NONE-1")
    AsignacionClasificacionFactura.objects.create(
        factura=factura_low,
        categoria_sugerida=categoria,
        confianza=Confianza.LOW,
    )
    AsignacionClasificacionFactura.objects.create(
        factura=factura_none,
        categoria_sugerida=None,
        confianza=Confianza.MEDIUM,
    )

    response = client.get("/ingesta/revisar/")

    assert response.status_code == 200
    content = response.content.decode("utf-8")
    assert "CLAVE-LOW-1" in content
    assert "CLAVE-NONE-1" in content
