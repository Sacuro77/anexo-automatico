const { app, BrowserWindow, ipcMain } = require("electron");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs/promises");
const { chromium } = require("playwright");
const {
  buildActionContext,
  getActionsFromPlan,
  getCurrentAction,
  interpolateDeep,
  resolveCategoryOption,
  validateConfigForAction,
  validateFlowConfig
} = require("./step_runner");

let mainWindow = null;

const state = {
  browser: null,
  context: null,
  page: null,
  loggedIn: false,
  plan: null,
  planIndex: 0
};

const SCREENSHOT_DIR = path.join(__dirname, "..", "tmp", "agent_desktop_screenshots");
const CONFIG_PATH = path.join(__dirname, "sri_flow_config.json");

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

function buildUrl(baseUrl, pathSuffix) {
  if (!baseUrl) {
    throw new Error("Missing base URL");
  }
  const trimmed = baseUrl.replace(/\/+$/, "");
  return `${trimmed}${pathSuffix}`;
}

function requireValue(value, label) {
  if (!value) {
    throw new Error(`Missing ${label}`);
  }
}

async function requestJson(method, url, token, body) {
  requireValue(token, "token");

  const headers = {
    Authorization: `Bearer ${token}`
  };

  if (body) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  let data = text;

  if (contentType.includes("application/json")) {
    try {
      data = JSON.parse(text);
    } catch (error) {
      data = text;
    }
  }

  if (!response.ok) {
    const message = typeof data === "string" ? data : JSON.stringify(data);
    throw new Error(`HTTP ${response.status}: ${message}`);
  }

  return data;
}

async function postEvent(baseUrl, token, eventPayload) {
  const url = buildUrl(baseUrl, "/api/agent/events");
  return requestJson("POST", url, token, eventPayload);
}

function buildEvent(importacionId, step, status, message, extra = {}) {
  return {
    importacion_id: importacionId,
    step,
    status,
    message,
    ts: new Date().toISOString(),
    ...extra
  };
}

function getStateSnapshot() {
  return {
    browserOpen: Boolean(state.browser),
    contextReady: Boolean(state.context),
    pageReady: Boolean(state.page),
    loggedIn: state.loggedIn,
    currentUrl: state.page ? state.page.url() : null
  };
}

function sanitizeLabel(label) {
  if (!label) {
    return "screenshot";
  }
  return label.replace(/[^a-z0-9_-]/gi, "_").slice(0, 48);
}

async function loadFlowConfig() {
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf-8");
    return JSON.parse(raw);
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    throw new Error(`Config requerida (${CONFIG_PATH}): ${message}`);
  }
}

async function getConfigStatus() {
  try {
    const config = await loadFlowConfig();
    return { config, validation: validateFlowConfig(config), error: null };
  } catch (error) {
    return { config: null, validation: { ok: false, errors: ["config missing"] }, error };
  }
}

async function requireConfigForAction(actionName) {
  const config = await loadFlowConfig();
  const validation = validateConfigForAction(config, actionName);
  if (!validation.ok) {
    throw new Error(`Config requerida: ${validation.errors.join(", ")}`);
  }
  return config;
}

function buildStepContext(action, config) {
  return buildActionContext(action, {
    target_url_login: config && config.target_url_login ? config.target_url_login : ""
  });
}

function ensureAssistedPreconditions() {
  if (!state.page) {
    throw new Error("Browser page is not ready. Open the browser first.");
  }
  if (!state.loggedIn) {
    throw new Error("Login pendiente. Marca 'Ya inicie sesion (continuar)'.");
  }
  if (!state.plan) {
    throw new Error("Plan no cargado.");
  }
  const action = getCurrentAction(state.plan, state.planIndex);
  if (!action) {
    throw new Error("Plan sin acciones disponibles.");
  }
  return action;
}

async function runStepSequence(steps, context, options = {}) {
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error("Config requerida: steps vacios.");
  }
  if (!state.page) {
    throw new Error("Browser page is not ready.");
  }

  const page = state.page;
  const logs = [];
  const timeoutDefault = options.timeout || 15000;

  for (let index = 0; index < steps.length; index += 1) {
    const rawStep = steps[index];
    const step = interpolateDeep(rawStep, context);
    if (!step || typeof step !== "object") {
      throw new Error(`Step invalido en indice ${index}.`);
    }
    const stepType = step.type;
    const timeout = step.timeout || timeoutDefault;
    logs.push({ index, type: stepType, ts: new Date().toISOString(), status: "start" });

    switch (stepType) {
      case "goto":
        requireValue(step.url, "step.url");
        await page.goto(step.url, {
          waitUntil: step.waitUntil || "domcontentloaded",
          timeout
        });
        break;
      case "click":
        requireValue(step.selector, "step.selector");
        await page.click(step.selector, { timeout });
        break;
      case "fill":
        requireValue(step.selector, "step.selector");
        requireValue(step.text, "step.text");
        await page.fill(step.selector, step.text, { timeout });
        break;
      case "select": {
        requireValue(step.selector, "step.selector");
        const option = step.value
          ? { value: String(step.value) }
          : step.label
            ? { label: String(step.label) }
            : step.text
              ? { label: String(step.text) }
              : null;
        if (!option) {
          throw new Error("step.select requiere value/label/text.");
        }
        await page.selectOption(step.selector, option, { timeout });
        break;
      }
      case "waitForSelector":
        requireValue(step.selector, "step.selector");
        await page.waitForSelector(step.selector, { timeout });
        break;
      case "waitForURL":
        if (step.url) {
          await page.waitForURL(step.url, { timeout });
        } else if (step.pattern) {
          const regex = new RegExp(step.pattern);
          await page.waitForURL(regex, { timeout });
        } else {
          throw new Error("step.waitForURL requiere url o pattern.");
        }
        break;
      case "expectText": {
        requireValue(step.selector, "step.selector");
        requireValue(step.text, "step.text");
        const content = await page.textContent(step.selector, { timeout });
        if (!content || !content.includes(step.text)) {
          throw new Error(`Texto esperado no encontrado: ${step.text}`);
        }
        break;
      }
      case "press":
        requireValue(step.selector, "step.selector");
        requireValue(step.key, "step.key");
        await page.press(step.selector, step.key, { timeout });
        break;
      default:
        throw new Error(`Tipo de step no soportado: ${stepType}`);
    }

    logs.push({ index, type: stepType, ts: new Date().toISOString(), status: "ok" });
  }

  return { logs };
}

async function captureScreenshotEvidence(label) {
  if (!state.page) {
    return null;
  }

  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  const safeLabel = sanitizeLabel(label);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `${timestamp}_${safeLabel}.png`;
  const filePath = path.join(SCREENSHOT_DIR, fileName);

  await state.page.screenshot({ path: filePath, fullPage: true });
  const buffer = await fs.readFile(filePath);
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  return {
    filePath,
    sha256,
    size: buffer.length
  };
}

async function captureScreenshot(label) {
  const evidence = await captureScreenshotEvidence(label);
  return evidence ? evidence.filePath : null;
}

async function runStep(
  { baseUrl, token, importacionId, step, message, eventExtra = {}, emitSuccess = true },
  action
) {
  requireValue(baseUrl, "base_url");
  requireValue(token, "token");
  requireValue(importacionId, "importacion_id");

  try {
    const result = await action();
    let eventResponse = null;
    let eventPayload = null;
    if (emitSuccess) {
      eventPayload = buildEvent(importacionId, step, "ok", message, eventExtra);
      eventResponse = await postEvent(baseUrl, token, eventPayload);
    }
    return { result, event: eventResponse, eventPayload };
  } catch (error) {
    let evidence = null;
    try {
      evidence = await captureScreenshotEvidence(`error_${step}`);
    } catch (screenshotError) {
      evidence = null;
    }

    const errorMessage = error && error.message ? error.message : String(error);
    const baseMessage = `step=${step} error=${errorMessage}`;
    const fullMessage = evidence
      ? `${baseMessage} | evidence_path=${evidence.filePath} | sha256=${evidence.sha256} | size=${evidence.size}`
      : baseMessage;

    try {
      const eventPayload = buildEvent(
        importacionId,
        step,
        "error",
        fullMessage,
        eventExtra
      );
      await postEvent(baseUrl, token, eventPayload);
    } catch (postError) {
      // Ignore secondary failure so the original error is surfaced.
    }

    if (error && typeof error === "object") {
      error.message = fullMessage;
      throw error;
    }
    throw new Error(fullMessage);
  }
}

async function ensureBrowserState() {
  if (!state.browser) {
    state.browser = await chromium.launch({ headless: false });
  }

  let createdContext = false;
  if (!state.context) {
    state.context = await state.browser.newContext();
    createdContext = true;
  }

  if (!state.page) {
    state.page = await state.context.newPage();
  }

  if (createdContext) {
    state.loggedIn = false;
  }
}

async function runProviderOpen(config, action) {
  const context = buildStepContext(action, config);
  return runStepSequence(config.provider_open.steps, context);
}

async function runInvoiceOpen(config, action) {
  const context = buildStepContext(action, config);
  return runStepSequence(config.invoice_open.steps, context);
}

async function runApplyPrepare(config, action) {
  const context = buildStepContext(action, config);
  if (Array.isArray(config.apply.steps_before_confirm) && config.apply.steps_before_confirm.length) {
    await runStepSequence(config.apply.steps_before_confirm, context);
  }

  const page = state.page;
  const categoryKey =
    context.categoria_objetivo || context.categoria_nombre || context.categoria_id;
  if (!categoryKey) {
    throw new Error("Categoria objetivo no disponible en el plan.");
  }

  const option = resolveCategoryOption(categoryKey, config.apply.category_map);
  if (!option) {
    throw new Error(`Sin mapeo para categoria: ${categoryKey}`);
  }

  const selector = interpolateDeep(config.apply.category_selector, context);
  requireValue(selector, "apply.category_selector");

  const mode = config.apply.category_mode || "select";
  if (mode === "fill") {
    const text = option.text || option.label || option.value || String(categoryKey);
    await page.fill(selector, text, { timeout: 15000 });
    return { selected: text };
  }

  if (mode === "click") {
    await page.click(selector, { timeout: 15000 });
    const optionSelector = interpolateDeep(
      config.apply.category_option_selector,
      {
        ...context,
        value: option.value || "",
        label: option.label || option.text || ""
      }
    );
    requireValue(optionSelector, "apply.category_option_selector");
    await page.click(optionSelector, { timeout: 15000 });
    return { selected: option.value || option.label || option.text || String(categoryKey) };
  }

  const selectOption = option.value
    ? { value: option.value }
    : { label: option.label || option.text || String(categoryKey) };
  await page.selectOption(selector, selectOption, { timeout: 15000 });
  return { selected: selectOption.value || selectOption.label };
}

async function runApplyConfirm(config, action) {
  const context = buildStepContext(action, config);
  const selector = interpolateDeep(config.apply.confirm_selector, context);
  requireValue(selector, "apply.confirm_selector");
  await state.page.click(selector, { timeout: 15000 });
}

ipcMain.handle("agent:openBrowser", async (_event, payload) => {
  const { baseUrl, token, importacionId } = payload;
  return runStep(
    {
      baseUrl,
      token,
      importacionId,
      step: "browser_open",
      message: "Browser opened"
    },
    async () => {
      await ensureBrowserState();
      return getStateSnapshot();
    }
  );
});

ipcMain.handle("agent:goto", async (_event, payload) => {
  const { baseUrl, token, importacionId, url } = payload;
  return runStep(
    {
      baseUrl,
      token,
      importacionId,
      step: "goto",
      message: `Navigated to ${url}`
    },
    async () => {
      requireValue(url, "target URL");
      if (!state.page) {
        throw new Error("Browser page is not ready. Open the browser first.");
      }
      await state.page.goto(url, { waitUntil: "domcontentloaded" });
      return getStateSnapshot();
    }
  );
});

ipcMain.handle("agent:markLoggedIn", async (_event, payload) => {
  const { baseUrl, token, importacionId } = payload;
  return runStep(
    {
      baseUrl,
      token,
      importacionId,
      step: "login_marked",
      message: "Login marked as complete"
    },
    async () => {
      state.loggedIn = true;
      return getStateSnapshot();
    }
  );
});

ipcMain.handle("agent:status", async (_event, payload) => {
  const { baseUrl, token, importacionId } = payload;
  return runStep(
    {
      baseUrl,
      token,
      importacionId,
      step: "status_check",
      message: "Status checked"
    },
    async () => getStateSnapshot()
  );
});

ipcMain.handle("agent:checkToken", async (_event, payload) => {
  const { baseUrl, token } = payload;
  requireValue(baseUrl, "base_url");
  requireValue(token, "token");
  const url = buildUrl(baseUrl, "/api/agent/me");
  return requestJson("GET", url, token);
});

ipcMain.handle("agent:loadPlan", async (_event, payload) => {
  const { baseUrl, token, importacionId } = payload;
  requireValue(baseUrl, "base_url");
  requireValue(token, "token");
  requireValue(importacionId, "importacion_id");

  const url = buildUrl(
    baseUrl,
    `/api/agent/importaciones/${importacionId}/plan.json`
  );
  const plan = await requestJson("GET", url, token);
  const actions = getActionsFromPlan(plan);
  state.plan = plan;
  state.planIndex = 0;
  const currentItem = actions[0] || null;
  const configStatus = await getConfigStatus();

  const eventPayload = buildEvent(
    importacionId,
    "plan_loaded",
    "ok",
    `Plan con ${actions.length} acciones.`
  );
  const eventResponse = await postEvent(baseUrl, token, eventPayload);

  return {
    plan,
    actionsCount: actions.length,
    currentIndex: state.planIndex,
    currentItem,
    configStatus: {
      ok: configStatus.validation.ok,
      errors: configStatus.validation.errors,
      error: configStatus.error ? configStatus.error.message : null
    },
    event: eventResponse,
    eventPayload
  };
});

ipcMain.handle("agent:providerOpen", async (_event, payload) => {
  const { baseUrl, token, importacionId } = payload;
  const currentAction = getCurrentAction(state.plan, state.planIndex) || {};
  const proveedorLabel =
    currentAction.proveedor_ruc || currentAction.proveedor_id || "N/A";
  return runStep(
    {
      baseUrl,
      token,
      importacionId,
      step: "provider_open",
      message: `Proveedor abierto (${proveedorLabel}).`
    },
    async () => {
      const action = ensureAssistedPreconditions();
      const config = await requireConfigForAction("provider_open");
      const result = await runProviderOpen(config, action);
      return {
        snapshot: getStateSnapshot(),
        logs: result.logs
      };
    }
  );
});

ipcMain.handle("agent:invoiceOpen", async (_event, payload) => {
  const { baseUrl, token, importacionId } = payload;
  const currentAction = getCurrentAction(state.plan, state.planIndex) || {};
  const facturaLabel =
    currentAction.clave_acceso || currentAction.factura_id || "N/A";
  const eventExtra = currentAction.factura_id ? { factura_id: currentAction.factura_id } : {};
  return runStep(
    {
      baseUrl,
      token,
      importacionId,
      step: "invoice_open",
      message: `Factura abierta (${facturaLabel}).`,
      eventExtra
    },
    async () => {
      const action = ensureAssistedPreconditions();
      const config = await requireConfigForAction("invoice_open");
      const result = await runInvoiceOpen(config, action);
      return {
        snapshot: getStateSnapshot(),
        logs: result.logs
      };
    }
  );
});

ipcMain.handle("agent:applyPrepare", async (_event, payload) => {
  const { baseUrl, token, importacionId } = payload;
  const currentAction = getCurrentAction(state.plan, state.planIndex) || {};
  const eventExtra = currentAction.factura_id ? { factura_id: currentAction.factura_id } : {};
  return runStep(
    {
      baseUrl,
      token,
      importacionId,
      step: "apply",
      message: "Categoria preparada",
      emitSuccess: false,
      eventExtra
    },
    async () => {
      const action = ensureAssistedPreconditions();
      const config = await requireConfigForAction("apply");
      const result = await runApplyPrepare(config, action);
      return {
        snapshot: getStateSnapshot(),
        prepare: result
      };
    }
  );
});

ipcMain.handle("agent:applyConfirm", async (_event, payload) => {
  const { baseUrl, token, importacionId } = payload;
  const currentAction = getCurrentAction(state.plan, state.planIndex) || {};
  const categoriaLabel =
    currentAction.categoria_nombre || currentAction.categoria_id || "categoria";
  const facturaLabel =
    currentAction.clave_acceso || currentAction.factura_id || "factura";
  const eventExtra = currentAction.factura_id ? { factura_id: currentAction.factura_id } : {};
  return runStep(
    {
      baseUrl,
      token,
      importacionId,
      step: "apply",
      message: `Categoria ${categoriaLabel} aplicada a ${facturaLabel}.`,
      eventExtra
    },
    async () => {
      const action = ensureAssistedPreconditions();
      const config = await requireConfigForAction("apply");
      await runApplyConfirm(config, action);
      const actions = getActionsFromPlan(state.plan);
      if (state.planIndex < actions.length - 1) {
        state.planIndex += 1;
      }
      return {
        snapshot: getStateSnapshot(),
        planState: {
          currentIndex: state.planIndex,
          currentItem: getCurrentAction(state.plan, state.planIndex)
        }
      };
    }
  );
});

ipcMain.handle("agent:screenshot", async (_event, payload) => {
  const { baseUrl, token, importacionId, label } = payload;
  return runStep(
    {
      baseUrl,
      token,
      importacionId,
      step: "screenshot",
      message: `Screenshot captured: ${label || "manual"}`
    },
    async () => {
      const filePath = await captureScreenshot(label || "manual");
      if (!filePath) {
        throw new Error("No active page to capture screenshot.");
      }
      return { filePath };
    }
  );
});

ipcMain.handle("agent:postEvent", async (_event, payload) => {
  const { baseUrl, token, eventPayload } = payload;
  requireValue(baseUrl, "base_url");
  requireValue(token, "token");
  return postEvent(baseUrl, token, eventPayload);
});

app.whenReady().then(createWindow);

app.on("window-all-closed", async () => {
  if (state.browser) {
    await state.browser.close();
    state.browser = null;
    state.context = null;
    state.page = null;
    state.loggedIn = false;
  }
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
