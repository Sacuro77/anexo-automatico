# Agent Desktop MVP

Electron + Playwright desktop agent for assisted, step-by-step navigation.

## Run

1. `npm install`
2. `npx playwright install`
3. `npm start`

## Assisted flow

1. Abrir navegador.
2. Abrir SRI (o usar "Ir a URL (manual)").
3. Realizar login manual en la ventana del navegador.
4. Presionar "Ya inicie sesion (continuar)" para marcar el estado.
5. Enviar evento OK si quieres validar el pipeline de eventos.

## Notes

- Paste the token in the UI only. The app keeps it in memory and never writes it to disk.
- Default base URL is `http://localhost:8000`.
- Target URL defaults to `https://srienlinea.sri.gob.ec` and can be edited.
- Errors trigger a screenshot saved under `tmp/agent_desktop_screenshots/`.
- No automated login: the SRI session is manual by design.

## Manual validation

- Start the Django stack with docker compose.
- Run the Electron app and use the buttons in order.
- Verify events appear in the web UI under Agent Events.
