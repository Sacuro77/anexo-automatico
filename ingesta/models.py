from django.conf import settings
from django.db import models


class Importacion(models.Model):
    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        RUNNING = "RUNNING", "Running"
        DONE = "DONE", "Done"
        FAILED = "FAILED", "Failed"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="importaciones",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.PENDING,
    )
    total_archivos = models.PositiveIntegerField(default=0)
    total_facturas = models.PositiveIntegerField(default=0)
    total_proveedores = models.PositiveIntegerField(default=0)
    error_count = models.PositiveIntegerField(default=0)
    error_summary = models.TextField(blank=True)
    log_json = models.JSONField(null=True, blank=True)
    s3_key_zip = models.CharField(max_length=255, blank=True)

    def __str__(self) -> str:
        return f"Importacion {self.id} ({self.status})"


class Proveedor(models.Model):
    ruc = models.CharField(max_length=32, unique=True)
    razon_social = models.CharField(max_length=255, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return self.ruc


class Factura(models.Model):
    proveedor = models.ForeignKey(
        Proveedor,
        on_delete=models.PROTECT,
        related_name="facturas",
    )
    clave_acceso = models.CharField(max_length=64, unique=True)
    fecha_emision = models.DateField(null=True, blank=True)
    total = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    subtotal = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    iva = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    moneda = models.CharField(max_length=3, default="USD")
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return self.clave_acceso


class ArchivoFactura(models.Model):
    factura = models.OneToOneField(
        Factura,
        on_delete=models.CASCADE,
        related_name="archivo",
    )
    s3_key_xml = models.CharField(max_length=255, unique=True)
    sha256_xml = models.CharField(max_length=64, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return f"{self.factura_id} -> {self.s3_key_xml}"
