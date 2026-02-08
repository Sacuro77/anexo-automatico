from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("ingesta", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="Categoria",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("nombre", models.CharField(max_length=120)),
                ("codigo", models.CharField(blank=True, max_length=32)),
                ("activo", models.BooleanField(default=True)),
            ],
        ),
        migrations.CreateModel(
            name="ReglaClasificacion",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("prioridad", models.IntegerField(default=100)),
                ("tipo", models.CharField(choices=[("RUC", "RUC"), ("KEYWORD", "Keyword")], max_length=10)),
                ("patron", models.CharField(max_length=255)),
                ("confianza_base", models.CharField(choices=[("HIGH", "High"), ("MEDIUM", "Medium"), ("LOW", "Low")], default="MEDIUM", max_length=10)),
                ("activo", models.BooleanField(default=True)),
                ("categoria", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="reglas", to="ingesta.categoria")),
            ],
        ),
        migrations.CreateModel(
            name="AsignacionClasificacionFactura",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("confianza", models.CharField(choices=[("HIGH", "High"), ("MEDIUM", "Medium"), ("LOW", "Low")], default="LOW", max_length=10)),
                ("razones", models.JSONField(default=list)),
                ("metodo", models.CharField(choices=[("AUTO", "Auto"), ("MANUAL", "Manual")], default="AUTO", max_length=10)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("categoria_sugerida", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="asignaciones", to="ingesta.categoria")),
                ("factura", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="clasificacion", to="ingesta.factura")),
            ],
        ),
    ]
