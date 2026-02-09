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

let lastSnapshot = null;

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
  lastSnapshot = status;
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
  const trimmedUrl = targetUrl.trim();

  if (!trimmedUrl) {
    const currentUrl =
      (lastSnapshot && lastSnapshot.currentUrl) || statusUrl.textContent || "";
    const normalizedUrl = String(currentUrl).trim().toLowerCase();
    const onEditarAnexo = normalizedUrl.includes("editar-anexo.jsf");
    const onAnexosTable = normalizedUrl.includes("anexos.jsf");
    const inAnexoModule = normalizedUrl.includes("anexo-gastos-personales");

    let actionName = null;
    if (onEditarAnexo) {
      actionName = "anexo_open_facturas_electronicas";
    } else if (onAnexosTable) {
      actionName = "anexo_open_editar_anexo_2025";
    } else if (!inAnexoModule) {
      actionName = "anexo_open_anexos_home";
    }

    if (!actionName) {
      throw new Error(
        "Target URL requerido (o estar en Anexos/Editar para continuar)."
      );
    }

    appendLog(`Ejecutando action: ${actionName}...`);
    const data = await window.agentApi.runAction(
      baseUrl,
      token,
      importacionId,
      actionName,
      {}
    );
    appendLog("Action ejecutada", data.result);
    updateStatus(data.result && data.result.snapshot ? data.result.snapshot : data.result);
    updateLastEvent(data.eventPayload, data.event);
    return;
  }

  appendLog(`Navegando a ${trimmedUrl}...`);
  const data = await window.agentApi.goto(baseUrl, token, importacionId, trimmedUrl);
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

function requestRucModal(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.background = "rgba(15, 27, 36, 0.4)";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.padding = "24px";
    overlay.style.zIndex = "9999";

    const card = document.createElement("div");
    card.style.background = "#ffffff";
    card.style.borderRadius = "16px";
    card.style.padding = "20px";
    card.style.maxWidth = "420px";
    card.style.width = "100%";
    card.style.display = "grid";
    card.style.gap = "12px";
    card.style.boxShadow = "0 20px 40px rgba(15, 27, 36, 0.2)";

    const title = document.createElement("h3");
    title.textContent = message || "Ingrese RUC del proveedor";
    title.style.margin = "0";
    title.style.fontSize = "1.2rem";

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "RUC";
    input.style.padding = "10px 12px";
    input.style.borderRadius = "10px";
    input.style.border = "1px solid #cbd5df";
    input.style.fontSize = "0.95rem";

    const actions = document.createElement("div");
    actions.style.display = "grid";
    actions.style.gridTemplateColumns = "repeat(2, minmax(0, 1fr))";
    actions.style.gap = "12px";

    const btnCancel = document.createElement("button");
    btnCancel.type = "button";
    btnCancel.textContent = "Cancelar";
    btnCancel.className = "secondary";

    const btnOk = document.createElement("button");
    btnOk.type = "button";
    btnOk.textContent = "OK";

    actions.appendChild(btnCancel);
    actions.appendChild(btnOk);
    card.appendChild(title);
    card.appendChild(input);
    card.appendChild(actions);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const cleanup = (value) => {
      overlay.remove();
      resolve(value || "");
    };

    btnCancel.addEventListener("click", () => cleanup(""));
    btnOk.addEventListener("click", () => cleanup(input.value));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        cleanup(input.value);
      } else if (event.key === "Escape") {
        cleanup("");
      }
    });

    input.focus();
  });
}

async function handleProviderOpen() {
  const { baseUrl, token, importacionId } = getInputs();
  requireBaseInputs({ baseUrl, token, importacionId });
  requirePlanLoaded();

  const item = planState.currentItem || {};
  let ruc = item.ruc || item.proveedor_ruc || (item.proveedor && item.proveedor.ruc) || "";
  if (!ruc) {
    ruc = await requestRucModal("Ingrese RUC del proveedor");
  }
  ruc = String(ruc).trim();
  if (!ruc) {
    throw new Error("RUC requerido para abrir proveedor.");
  }

  appendLog(`Ir a proveedor por RUC: ${ruc}...`);
  const data = await window.agentApi.providerOpenByRuc(baseUrl, token, importacionId, ruc);
  appendLog(`Proveedor abierto por RUC: ${ruc}`, data.result);
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
  const nextPlanState = data.result && data.result.planState ? data.result.planState : null;
  if (nextPlanState) {
    planState.index = nextPlanState.currentIndex;
    planState.currentItem = nextPlanState.currentItem;
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
