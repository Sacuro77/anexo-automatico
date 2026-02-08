import pytest

from ingesta.models import Categoria, Confianza, Factura, Proveedor, ReglaClasificacion
from ingesta.services.classification import classify_factura


@pytest.mark.django_db
def test_regla_ruc_match_exacto():
    categoria = Categoria.objects.create(nombre="Servicios")
    ReglaClasificacion.objects.create(
        prioridad=1,
        tipo=ReglaClasificacion.Tipo.RUC,
        patron="1790012345001",
        categoria=categoria,
        confianza_base=Confianza.HIGH,
    )
    proveedor = Proveedor.objects.create(ruc="1790012345001", razon_social="Proveedor X")
    factura = Factura.objects.create(proveedor=proveedor, clave_acceso="CLAVE-001")

    categoria_out, confianza, razones = classify_factura(factura)

    assert categoria_out == categoria
    assert confianza == Confianza.HIGH
    assert "RUC match 1790012345001" in razones


@pytest.mark.django_db
def test_regla_keyword_case_insensitive():
    categoria = Categoria.objects.create(nombre="Salud")
    ReglaClasificacion.objects.create(
        prioridad=1,
        tipo=ReglaClasificacion.Tipo.KEYWORD,
        patron="farmacia",
        categoria=categoria,
        confianza_base=Confianza.MEDIUM,
    )
    proveedor = Proveedor.objects.create(ruc="0999999999", razon_social="FARMACIA CENTRAL")
    factura = Factura.objects.create(proveedor=proveedor, clave_acceso="CLAVE-002")

    categoria_out, confianza, razones = classify_factura(factura)

    assert categoria_out == categoria
    assert confianza == Confianza.MEDIUM
    assert "Keyword 'farmacia' matched" in razones


@pytest.mark.django_db
def test_precedencia_ruc_sobre_keyword():
    categoria_ruc = Categoria.objects.create(nombre="Gobierno")
    categoria_kw = Categoria.objects.create(nombre="Retail")
    ReglaClasificacion.objects.create(
        prioridad=1,
        tipo=ReglaClasificacion.Tipo.KEYWORD,
        patron="TIENDA",
        categoria=categoria_kw,
        confianza_base=Confianza.LOW,
    )
    ReglaClasificacion.objects.create(
        prioridad=1,
        tipo=ReglaClasificacion.Tipo.RUC,
        patron="1790012345001",
        categoria=categoria_ruc,
        confianza_base=Confianza.HIGH,
    )
    proveedor = Proveedor.objects.create(ruc="1790012345001", razon_social="Tienda Central")
    factura = Factura.objects.create(proveedor=proveedor, clave_acceso="CLAVE-003")

    categoria_out, confianza, _razones = classify_factura(factura)

    assert categoria_out == categoria_ruc
    assert confianza == Confianza.HIGH
