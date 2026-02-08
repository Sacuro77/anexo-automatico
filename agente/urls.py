from django.urls import path

from agente import views

urlpatterns = [
    path("api/agent/tokens", views.create_token_api, name="agente-api-token-create"),
    path("api/agent/me", views.agent_me, name="agente-api-me"),
    path(
        "api/agent/importaciones/<int:importacion_id>/plan.json",
        views.agent_plan_json,
        name="agente-api-plan-json",
    ),
    path("api/agent/events", views.agent_events, name="agente-api-events"),
    path(
        "ingesta/importaciones/<int:importacion_id>/token",
        views.generate_importacion_token,
        name="agente-generate-token",
    ),
]
