import io
import zipfile

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import IntegrityError, transaction

from ingesta.models import ArchivoFactura, Factura, Importacion, Proveedor
from ingesta.services.parser_xml import parse_xml_bytes


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
