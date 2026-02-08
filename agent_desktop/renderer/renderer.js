const baseUrlInput = document.getElementById("baseUrl");
const tokenInput = document.getElementById("token");
const importacionIdInput = document.getElementById("importacionId");
const logs = document.getElementById("logs");

const DEFAULT_SRI_URL = "https://www.google.com";

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

function getInputs() {
  const baseUrl = baseUrlInput.value.trim();
  const token = tokenInput.value.trim();
  const importacionId = importacionIdInput.value.trim();
  return { baseUrl, token, importacionId };
}

function requireValue(value, label) {
  if (!value) {
    throw new Error(`Missing ${label}`);
  }
}

async function handleTest() {
  const { baseUrl, token } = getInputs();
  requireValue(baseUrl, "base URL");
  requireValue(token, "token");

  appendLog("Testing /api/agent/me...");
  const data = await window.agentApi.testConnection(baseUrl, token);
  appendLog("Connection OK", data);
}

async function handlePlan() {
  const { baseUrl, token, importacionId } = getInputs();
  requireValue(baseUrl, "base URL");
  requireValue(token, "token");
  requireValue(importacionId, "importacion_id");

  appendLog("Downloading plan.json...");
  const data = await window.agentApi.downloadPlan(baseUrl, token, importacionId);
  appendLog("Plan downloaded", data);
}

async function handleEvent() {
  const { baseUrl, token, importacionId } = getInputs();
  requireValue(baseUrl, "base URL");
  requireValue(token, "token");
  requireValue(importacionId, "importacion_id");

  const eventPayload = {
    importacion_id: importacionId,
    step: "ui_test",
    status: "ok",
    message: "Manual UI test from agent desktop",
    ts: new Date().toISOString()
  };

  appendLog("Posting event...", eventPayload);
  const data = await window.agentApi.registerEvent(baseUrl, token, eventPayload);
  appendLog("Event recorded", data);
}

async function handleBrowser() {
  const { baseUrl, token, importacionId } = getInputs();
  requireValue(baseUrl, "base URL");
  requireValue(token, "token");
  requireValue(importacionId, "importacion_id");

  appendLog(`Opening browser at ${DEFAULT_SRI_URL}...`);
  const data = await window.agentApi.openBrowser(
    baseUrl,
    token,
    importacionId,
    DEFAULT_SRI_URL
  );
  appendLog("Browser opened", data);
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

bindButton("btnTest", handleTest);
bindButton("btnPlan", handlePlan);
bindButton("btnEvent", handleEvent);
bindButton("btnBrowser", handleBrowser);
