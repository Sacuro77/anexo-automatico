from django.contrib import admin

from agente.models import AgentEvent, AgentToken


@admin.register(AgentToken)
class AgentTokenAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "name",
        "user",
        "allowed_importacion",
        "expires_at",
        "revoked_at",
        "last_seen_at",
        "created_at",
    )
    list_filter = ("revoked_at",)
    search_fields = ("name", "token_hash", "user__username", "user__email")


@admin.register(AgentEvent)
class AgentEventAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "token",
        "importacion",
        "factura_id",
        "step",
        "status",
        "event_ts",
        "created_at",
    )
    list_filter = ("status",)
    search_fields = ("step", "status", "message")
