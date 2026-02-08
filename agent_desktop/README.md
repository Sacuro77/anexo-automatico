# Agent Desktop MVP

Electron + Playwright desktop agent for assisted, step-by-step navigation.

## Run

1. `npm install`
2. `npx playwright install`
3. `npm start`

## Config SRI (step runner)

Edit `agent_desktop/sri_flow_config.json` with the real selectors and steps.

Notes:
- No credentials: the agent never asks for or stores passwords.
- Steps support templates like `{{proveedor_ruc}}`, `{{clave_acceso}}`, `{{categoria_objetivo}}`.
- `provider_open.steps` and `invoice_open.steps` are required and must be non-empty.
- `apply` requires:
  - `category_selector`
  - `category_map` (map from categoria_objetivo to value/label)
  - `confirm_selector` (button to save/apply)
  - optional `steps_before_confirm`

Supported step types: `goto`, `click`, `fill`, `select`, `waitForSelector`, `waitForURL`, `expectText`, `press`.

## Assisted flow

1. Abrir navegador.
2. Abrir SRI (o usar "Ir a URL (manual)").
3. Realizar login manual en la ventana del navegador.
4. Presionar "Ya inicie sesion (continuar)" para marcar el estado.
5. Cargar plan.
6. Ir a proveedor.
7. Abrir factura.
8. Aplicar categoria (1) -> confirmar en el modal.
9. Enviar evento OK si quieres validar el pipeline de eventos.

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
- Confirm the modal appears before the final apply click.
- If a step fails, check the evidence path logged in the error message.

## Tests

Run: `npm test`
