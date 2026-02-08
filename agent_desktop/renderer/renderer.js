const baseUrlInput = document.getElementById("baseUrl");
const tokenInput = document.getElementById("token");
const importacionIdInput = document.getElementById("importacionId");
const targetUrlInput = document.getElementById("targetUrl");
const logs = document.getElementById("logs");

const statusBrowser = document.getElementById("statusBrowser");
const statusContext = document.getElementById("statusContext");
const statusPage = document.getElementById("statusPage");
const statusLogin = document.getElementById("statusLogin");
const statusToken = document.getElementById("statusToken");
const statusUrl = document.getElementById("statusUrl");

const planCount = document.getElementById("planCount");
const planIndex = document.getElementById("planIndex");
const planImportacion = document.getElementById("planImportacion");
const planProveedor = document.getElementById("planProveedor");
const planFactura = document.getElementById("planFactura");
const planCategoria = document.getElementById("planCategoria");
const planConfianza = document.getElementById("planConfianza");

const lastEvent = document.getElementById("lastEvent");
const lastError = document.getElementById("lastError");
const btnCopyError = document.getElementById("btnCopyError");

const btnConfirmApply = document.getElementById("btnConfirmApply");
const btnConfirmCancel = document.getElementById("btnConfirmCancel");
const confirmModal = document.getElementById("confirmModal");
const confirmMessage = document.getElementById("confirmMessage");

const DEFAULT_SRI_URL = "https://srienlinea.sri.gob.ec";

const planState = {
  loaded: false,
  total: 0,
  index: 0,
  importacionId: null,
  currentItem: null
};

const assistState = {
  pendingApply: false,
  pendingItem: null
};

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

function updateTokenStatus(data) {
  if (!data) {
    statusToken.textContent = "-";
    return;
  }
  if (data.ok) {
    statusToken.textContent = `ok (expira ${data.expires_at || "-"})`;
  } else {
    statusToken.textContent = "expirado";
  }
}

function updatePlanUi() {
  planCount.textContent = planState.loaded ? String(planState.total) : "-";
  planIndex.textContent = planState.loaded ? String(planState.index) : "-";
  planImportacion.textContent = planState.loaded ? String(planState.importacionId || "-") : "-";

  const item = planState.currentItem || {};
  const proveedor = item.proveedor_ruc || item.proveedor_id || "-";
  const factura = item.clave_acceso || item.factura_id || "-";
  const categoria = item.categoria_nombre || item.categoria_id || item.categoria_objetivo || "-";
  const confianza = item.confianza || "-";

  planProveedor.textContent = planState.loaded ? String(proveedor) : "-";
  planFactura.textContent = planState.loaded ? String(factura) : "-";
  planCategoria.textContent = planState.loaded ? String(categoria) : "-";
  planConfianza.textContent = planState.loaded ? String(confianza) : "-";
}

function updateLastEvent(payload, response) {
  if (!payload) {
    lastEvent.textContent = "-";
    return;
  }
  const data = {
    payload,
    response
  };
  lastEvent.textContent = JSON.stringify(data, null, 2);
}

function updateLastError(message) {
  lastError.textContent = message || "-";
}

function showConfirmModal(message) {
  confirmMessage.textContent = message;
  confirmModal.classList.add("active");
}

function hideConfirmModal() {
  confirmModal.classList.remove("active");
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

async function handleCheckToken() {
  const { baseUrl, token } = getInputs();
  requireValue(baseUrl, "base URL");
  requireValue(token, "token");

  appendLog("Verificando token...");
  const data = await window.agentApi.checkToken(baseUrl, token);
  appendLog("Token OK", data);
  updateTokenStatus(data);
}

async function handleLoadPlan() {
  const { baseUrl, token, importacionId } = getInputs();
  requireBaseInputs({ baseUrl, token, importacionId });

  await handleCheckToken();
  appendLog("Cargando plan...");
  const data = await window.agentApi.loadPlan(baseUrl, token, importacionId);
  appendLog("Plan cargado", {
    actionsCount: data.actionsCount,
    currentIndex: data.currentIndex,
    currentItem: data.currentItem
  });

  planState.loaded = true;
  planState.total = data.actionsCount || 0;
  planState.index = data.currentIndex || 0;
  planState.importacionId = data.plan ? data.plan.importacion_id : importacionId;
  planState.currentItem = data.currentItem;
  updatePlanUi();
  updateLastEvent(data.eventPayload, data.event);
}

function requirePlanLoaded() {
  if (!planState.loaded || !planState.currentItem) {
    throw new Error("Plan no cargado o sin acciones.");
  }
}

async function handleProviderOpen() {
  const { baseUrl, token, importacionId } = getInputs();
  requireBaseInputs({ baseUrl, token, importacionId });
  requirePlanLoaded();

  appendLog("Ir a proveedor...");
  const data = await window.agentApi.providerOpen(baseUrl, token, importacionId);
  appendLog("Proveedor abierto", data.result);
  updateStatus(data.result && data.result.snapshot ? data.result.snapshot : data.result);
  updateLastEvent(data.eventPayload, data.event);
}

async function handleInvoiceOpen() {
  const { baseUrl, token, importacionId } = getInputs();
  requireBaseInputs({ baseUrl, token, importacionId });
  requirePlanLoaded();

  appendLog("Abrir factura...");
  const data = await window.agentApi.invoiceOpen(baseUrl, token, importacionId);
  appendLog("Factura abierta", data.result);
  updateStatus(data.result && data.result.snapshot ? data.result.snapshot : data.result);
  updateLastEvent(data.eventPayload, data.event);
}

async function handleApplyPrepare() {
  const { baseUrl, token, importacionId } = getInputs();
  requireBaseInputs({ baseUrl, token, importacionId });
  requirePlanLoaded();

  appendLog("Preparando categoria...");
  const data = await window.agentApi.applyPrepare(baseUrl, token, importacionId);
  appendLog("Categoria preparada", data.result);
  assistState.pendingApply = true;
  assistState.pendingItem = planState.currentItem;
  const categoria =
    planState.currentItem.categoria_nombre ||
    planState.currentItem.categoria_id ||
    planState.currentItem.categoria_objetivo ||
    "-";
  const factura =
    planState.currentItem.clave_acceso ||
    planState.currentItem.factura_id ||
    planState.currentItem.factura_uuid ||
    "-";
  showConfirmModal(`Confirmar: aplicar categoria ${categoria} a factura ${factura}`);
}

async function handleApplyConfirm() {
  const { baseUrl, token, importacionId } = getInputs();
  requireBaseInputs({ baseUrl, token, importacionId });
  if (!assistState.pendingApply) {
    throw new Error("No hay aplicacion pendiente.");
  }

  appendLog("Aplicando categoria (confirmado)...");
  const data = await window.agentApi.applyConfirm(baseUrl, token, importacionId);
  appendLog("Categoria aplicada", data.result);
  updateStatus(data.result && data.result.snapshot ? data.result.snapshot : data.result);
  updateLastEvent(data.eventPayload, data.event);

  assistState.pendingApply = false;
  assistState.pendingItem = null;
  if (data.planState) {
    planState.index = data.planState.currentIndex;
    planState.currentItem = data.planState.currentItem;
    updatePlanUi();
  }
  hideConfirmModal();
}

function handleApplyCancel() {
  assistState.pendingApply = false;
  assistState.pendingItem = null;
  hideConfirmModal();
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
  updateLastEvent(eventPayload, data);
}

function bindButton(id, handler) {
  const button = document.getElementById(id);
  button.addEventListener("click", async () => {
    try {
      await handler();
    } catch (error) {
      const message = error.message || String(error);
      appendLog("Error", message);
      updateLastError(message);
    }
  });
}

bindButton("btnOpenBrowser", handleOpenBrowser);
bindButton("btnOpenSri", handleOpenSri);
bindButton("btnLoggedIn", handleLoggedIn);
bindButton("btnGoto", handleGoto);
bindButton("btnLoadPlan", handleLoadPlan);
bindButton("btnEventOk", handleEventOk);
bindButton("btnProviderOpen", handleProviderOpen);
bindButton("btnInvoiceOpen", handleInvoiceOpen);
bindButton("btnApplyCategory", handleApplyPrepare);

btnConfirmApply.addEventListener("click", async () => {
  try {
    await handleApplyConfirm();
  } catch (error) {
    const message = error.message || String(error);
    appendLog("Error", message);
    updateLastError(message);
  }
});

btnConfirmCancel.addEventListener("click", handleApplyCancel);
btnCopyError.addEventListener("click", async () => {
  const text = lastError.textContent || "";
  if (!text || text === "-") {
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    appendLog("Error copiado");
  } catch (error) {
    appendLog("No se pudo copiar", error.message || String(error));
  }
});
