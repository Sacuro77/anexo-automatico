from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from agente.models import AgentEvent, AgentToken
from ingesta.models import Importacion


class ImportacionDetailAgentEventsTests(TestCase):
    def test_detail_muestra_eventos_agente(self):
        importacion = Importacion.objects.create()
        token = AgentToken.objects.create(
            token_hash="b" * 64,
            expires_at=timezone.now() + timedelta(hours=1),
        )
        AgentEvent.objects.create(
            token=token,
            importacion=importacion,
            step="ui_smoke",
            status="ok",
            message="evento visible",
        )

        response = self.client.get(f"/ingesta/importaciones/{importacion.id}/")

        self.assertEqual(response.status_code, 200)
        content = response.content.decode("utf-8")
        self.assertIn("Eventos del agente", content)
        self.assertIn("ui_smoke", content)
        self.assertIn("evento visible", content)
