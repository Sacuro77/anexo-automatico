from django.contrib import admin

from .models import ArchivoFactura, Factura, Importacion, Proveedor


@admin.register(Importacion)
class ImportacionAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "status",
        "created_at",
        "started_at",
        "finished_at",
        "total_archivos",
        "total_facturas",
        "total_proveedores",
        "error_count",
    )
    list_filter = ("status", "created_at")
    search_fields = ("id", "error_summary")


@admin.register(Proveedor)
class ProveedorAdmin(admin.ModelAdmin):
    list_display = ("ruc", "razon_social", "created_at")
    search_fields = ("ruc", "razon_social")


@admin.register(Factura)
class FacturaAdmin(admin.ModelAdmin):
    list_display = (
        "clave_acceso",
        "proveedor",
        "fecha_emision",
        "total",
        "moneda",
        "created_at",
    )
    search_fields = ("clave_acceso", "proveedor__ruc")
    list_filter = ("moneda",)


@admin.register(ArchivoFactura)
class ArchivoFacturaAdmin(admin.ModelAdmin):
    list_display = ("factura", "s3_key_xml", "created_at")
    search_fields = ("s3_key_xml", "factura__clave_acceso")
