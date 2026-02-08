const baseUrlInput = document.getElementById("baseUrl");
const tokenInput = document.getElementById("token");
const importacionIdInput = document.getElementById("importacionId");
const targetUrlInput = document.getElementById("targetUrl");
const logs = document.getElementById("logs");

const statusBrowser = document.getElementById("statusBrowser");
const statusContext = document.getElementById("statusContext");
const statusPage = document.getElementById("statusPage");
const statusLogin = document.getElementById("statusLogin");
const statusUrl = document.getElementById("statusUrl");

const DEFAULT_SRI_URL = "https://srienlinea.sri.gob.ec";

function appendLog(message, data) {
  const timestamp = new Date().toISOString();
  let entry = `[${timestamp}] ${message}`;

  if (data !== undefined) {
    if (typeof data === "string") {
      entry += `\n${data}`;
    } else {
      entry += `\n${JSON.stringify(data, null, 2)}`;
    }
  }

  logs.textContent = `${logs.textContent}\n\n${entry}`.trim();
  logs.scrollTop = logs.scrollHeight;
}

function updateStatus(status) {
  if (!status) {
    return;
  }

  statusBrowser.textContent = status.browserOpen ? "abierto" : "cerrado";
  statusContext.textContent = status.contextReady ? "listo" : "no";
  statusPage.textContent = status.pageReady ? "lista" : "no";
  statusLogin.textContent = status.loggedIn ? "ok" : "pendiente";
  statusUrl.textContent = status.currentUrl || "-";
}

function getInputs() {
  const baseUrl = baseUrlInput.value.trim();
  const token = tokenInput.value.trim();
  const importacionId = importacionIdInput.value.trim();
  const targetUrl = targetUrlInput.value.trim();
  return { baseUrl, token, importacionId, targetUrl };
}

function requireValue(value, label) {
  if (!value) {
    throw new Error(`Missing ${label}`);
  }
}

function requireBaseInputs({ baseUrl, token, importacionId }) {
  requireValue(baseUrl, "base URL");
  requireValue(token, "token");
  requireValue(importacionId, "importacion_id");
}

async function handleOpenBrowser() {
  const { baseUrl, token, importacionId } = getInputs();
  requireBaseInputs({ baseUrl, token, importacionId });

  appendLog("Abriendo navegador...");
  const data = await window.agentApi.openBrowser(baseUrl, token, importacionId);
  appendLog("Navegador listo", data);
  updateStatus(data.result);
}

async function handleOpenSri() {
  const { baseUrl, token, importacionId } = getInputs();
  requireBaseInputs({ baseUrl, token, importacionId });

  appendLog(`Abriendo SRI en ${DEFAULT_SRI_URL}...`);
  const data = await window.agentApi.goto(baseUrl, token, importacionId, DEFAULT_SRI_URL);
  appendLog("SRI abierto", data);
  updateStatus(data.result);
}

async function handleLoggedIn() {
  const { baseUrl, token, importacionId } = getInputs();
  requireBaseInputs({ baseUrl, token, importacionId });

  appendLog("Marcando login como completado...");
  const data = await window.agentApi.markLoggedIn(baseUrl, token, importacionId);
  appendLog("Login marcado", data);
  updateStatus(data.result);
}

async function handleGoto() {
  const { baseUrl, token, importacionId, targetUrl } = getInputs();
  requireBaseInputs({ baseUrl, token, importacionId });
  requireValue(targetUrl, "target URL");

  appendLog(`Navegando a ${targetUrl}...`);
  const data = await window.agentApi.goto(baseUrl, token, importacionId, targetUrl);
  appendLog("Navegacion OK", data);
  updateStatus(data.result);
}

async function handleEventOk() {
  const { baseUrl, token, importacionId } = getInputs();
  requireBaseInputs({ baseUrl, token, importacionId });

  const eventPayload = {
    importacion_id: importacionId,
    step: "ui_smoke",
    status: "ok",
    message: "Manual OK from assisted desktop flow",
    ts: new Date().toISOString()
  };

  appendLog("Enviando evento OK...", eventPayload);
  const data = await window.agentApi.postEvent(baseUrl, token, eventPayload);
  appendLog("Evento enviado", data);
}

function bindButton(id, handler) {
  const button = document.getElementById(id);
  button.addEventListener("click", async () => {
    try {
      await handler();
    } catch (error) {
      appendLog("Error", error.message || String(error));
    }
  });
}

bindButton("btnOpenBrowser", handleOpenBrowser);
bindButton("btnOpenSri", handleOpenSri);
bindButton("btnLoggedIn", handleLoggedIn);
bindButton("btnGoto", handleGoto);
bindButton("btnEventOk", handleEventOk);
