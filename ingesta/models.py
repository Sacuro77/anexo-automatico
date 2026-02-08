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


class Categoria(models.Model):
    nombre = models.CharField(max_length=120)
    codigo = models.CharField(max_length=32, blank=True)
    activo = models.BooleanField(default=True)

    def __str__(self) -> str:
        if self.codigo:
            return f"{self.nombre} ({self.codigo})"
        return self.nombre


class Confianza(models.TextChoices):
    HIGH = "HIGH", "High"
    MEDIUM = "MEDIUM", "Medium"
    LOW = "LOW", "Low"


class ReglaClasificacion(models.Model):
    class Tipo(models.TextChoices):
        RUC = "RUC", "RUC"
        KEYWORD = "KEYWORD", "Keyword"

    prioridad = models.IntegerField(default=100)
    tipo = models.CharField(max_length=10, choices=Tipo.choices)
    patron = models.CharField(max_length=255)
    categoria = models.ForeignKey(
        Categoria,
        on_delete=models.PROTECT,
        related_name="reglas",
    )
    confianza_base = models.CharField(
        max_length=10,
        choices=Confianza.choices,
        default=Confianza.MEDIUM,
    )
    activo = models.BooleanField(default=True)

    def __str__(self) -> str:
        return f"{self.tipo}:{self.patron} -> {self.categoria}"


class AsignacionClasificacionFactura(models.Model):
    class Metodo(models.TextChoices):
        AUTO = "AUTO", "Auto"
        MANUAL = "MANUAL", "Manual"

    factura = models.OneToOneField(
        Factura,
        on_delete=models.CASCADE,
        related_name="clasificacion",
    )
    categoria_sugerida = models.ForeignKey(
        Categoria,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="asignaciones",
    )
    confianza = models.CharField(
        max_length=10,
        choices=Confianza.choices,
        default=Confianza.LOW,
    )
    razones = models.JSONField(default=list)
    metodo = models.CharField(
        max_length=10,
        choices=Metodo.choices,
        default=Metodo.AUTO,
    )
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"{self.factura_id} -> {self.categoria_sugerida_id or 'sin categoria'}"
