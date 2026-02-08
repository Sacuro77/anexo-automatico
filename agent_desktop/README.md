# Agent Desktop MVP

Minimal Electron + Playwright desktop agent for testing SaaS connectivity.

## Run

1. `npm install`
2. `npx playwright install`
3. `npm start`

## Notes

- Paste the token in the UI only. The app keeps it in memory and never writes it to disk.
- Default base URL is `http://localhost:8000`.
- The browser opens `https://www.google.com` by default. Adjust `DEFAULT_SRI_URL` in `agent_desktop/renderer/renderer.js` if needed.

## Manual validation

- Start the Django stack with docker compose.
- Run the Electron app and use the four buttons.
- Verify events appear in the web UI under Agent Events.
