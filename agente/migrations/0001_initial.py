from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("ingesta", "0002_clasificacion"),
    ]

    operations = [
        migrations.CreateModel(
            name="AgentToken",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("token_hash", models.CharField(max_length=64, unique=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("expires_at", models.DateTimeField()),
                ("revoked_at", models.DateTimeField(blank=True, null=True)),
                ("last_seen_at", models.DateTimeField(blank=True, null=True)),
                ("name", models.CharField(blank=True, max_length=120)),
                ("allowed_importacion", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="agent_tokens", to="ingesta.importacion")),
                ("user", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="agent_tokens", to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.CreateModel(
            name="AgentEvent",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("factura_id", models.IntegerField(blank=True, null=True)),
                ("step", models.CharField(max_length=120)),
                ("status", models.CharField(max_length=80)),
                ("message", models.TextField(blank=True)),
                ("event_ts", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("importacion", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="agent_events", to="ingesta.importacion")),
                ("token", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="events", to="agente.agenttoken")),
            ],
        ),
    ]
