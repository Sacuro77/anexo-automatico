from django.conf import settings
from django.db import models
from django.utils import timezone


class AgentToken(models.Model):
    token_hash = models.CharField(max_length=64, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True, blank=True)
    last_seen_at = models.DateTimeField(null=True, blank=True)
    name = models.CharField(max_length=120, blank=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="agent_tokens",
    )
    allowed_importacion = models.ForeignKey(
        "ingesta.Importacion",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="agent_tokens",
    )

    def is_expired(self, now=None) -> bool:
        now = now or timezone.now()
        return self.expires_at <= now

    def is_revoked(self) -> bool:
        return self.revoked_at is not None

    def allows_importacion(self, importacion_id: int) -> bool:
        if not self.allowed_importacion_id:
            return True
        return self.allowed_importacion_id == importacion_id

    def __str__(self) -> str:
        label = self.name or "Agent token"
        return f"{label} ({self.id})"


class AgentEvent(models.Model):
    token = models.ForeignKey(
        AgentToken,
        on_delete=models.CASCADE,
        related_name="events",
    )
    importacion = models.ForeignKey(
        "ingesta.Importacion",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="agent_events",
    )
    factura_id = models.IntegerField(null=True, blank=True)
    step = models.CharField(max_length=120)
    status = models.CharField(max_length=80)
    message = models.TextField(blank=True)
    event_ts = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return f"{self.step} ({self.status})"
