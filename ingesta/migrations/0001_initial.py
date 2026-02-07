from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="Importacion",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("started_at", models.DateTimeField(blank=True, null=True)),
                ("finished_at", models.DateTimeField(blank=True, null=True)),
                ("status", models.CharField(choices=[("PENDING", "Pending"), ("RUNNING", "Running"), ("DONE", "Done"), ("FAILED", "Failed")], default="PENDING", max_length=20)),
                ("total_archivos", models.PositiveIntegerField(default=0)),
                ("total_facturas", models.PositiveIntegerField(default=0)),
                ("total_proveedores", models.PositiveIntegerField(default=0)),
                ("error_count", models.PositiveIntegerField(default=0)),
                ("error_summary", models.TextField(blank=True)),
                ("log_json", models.JSONField(blank=True, null=True)),
                ("s3_key_zip", models.CharField(blank=True, max_length=255)),
                ("user", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="importaciones", to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.CreateModel(
            name="Proveedor",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("ruc", models.CharField(max_length=32, unique=True)),
                ("razon_social", models.CharField(blank=True, max_length=255, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
        ),
        migrations.CreateModel(
            name="Factura",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("clave_acceso", models.CharField(max_length=64, unique=True)),
                ("fecha_emision", models.DateField(blank=True, null=True)),
                ("total", models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True)),
                ("subtotal", models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True)),
                ("iva", models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True)),
                ("moneda", models.CharField(default="USD", max_length=3)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("proveedor", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="facturas", to="ingesta.proveedor")),
            ],
        ),
        migrations.CreateModel(
            name="ArchivoFactura",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("s3_key_xml", models.CharField(max_length=255, unique=True)),
                ("sha256_xml", models.CharField(blank=True, max_length=64, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("factura", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="archivo", to="ingesta.factura")),
            ],
        ),
    ]
