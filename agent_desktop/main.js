const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs/promises");
const { chromium } = require("playwright");

let mainWindow = null;

const state = {
  browser: null,
  context: null,
  page: null,
  loggedIn: false
};

const SCREENSHOT_DIR = path.join(__dirname, "..", "tmp", "agent_desktop_screenshots");

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

async function captureScreenshot(label) {
  if (!state.page) {
    return null;
  }

  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  const safeLabel = sanitizeLabel(label);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `${timestamp}_${safeLabel}.png`;
  const filePath = path.join(SCREENSHOT_DIR, fileName);

  await state.page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

async function runStep({ baseUrl, token, importacionId, step, message }, action) {
  requireValue(baseUrl, "base_url");
  requireValue(token, "token");
  requireValue(importacionId, "importacion_id");

  try {
    const result = await action();
    const eventPayload = buildEvent(importacionId, step, "ok", message);
    const eventResponse = await postEvent(baseUrl, token, eventPayload);
    return { result, event: eventResponse };
  } catch (error) {
    let screenshotPath = null;
    try {
      screenshotPath = await captureScreenshot(`error_${step}`);
    } catch (screenshotError) {
      screenshotPath = null;
    }

    const errorMessage = error && error.message ? error.message : String(error);
    const fullMessage = screenshotPath
      ? `${errorMessage} | screenshot: ${screenshotPath}`
      : errorMessage;

    try {
      const eventPayload = buildEvent(importacionId, step, "error", fullMessage);
      await postEvent(baseUrl, token, eventPayload);
    } catch (postError) {
      // Ignore secondary failure so the original error is surfaced.
    }

    throw error;
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
