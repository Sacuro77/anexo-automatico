const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { chromium } = require("playwright");

let mainWindow = null;
let browser = null;

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

async function requestJson(method, url, token, body) {
  if (!token) {
    throw new Error("Missing token");
  }

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

ipcMain.handle("agent:me", async (_event, payload) => {
  const { baseUrl, token } = payload;
  const url = buildUrl(baseUrl, "/api/agent/me");
  return requestJson("GET", url, token);
});

ipcMain.handle("agent:plan", async (_event, payload) => {
  const { baseUrl, token, importacionId } = payload;
  if (!importacionId) {
    throw new Error("Missing importacion_id");
  }
  const safeId = encodeURIComponent(importacionId);
  const url = buildUrl(baseUrl, `/api/agent/importaciones/${safeId}/plan.json`);
  return requestJson("GET", url, token);
});

ipcMain.handle("agent:event", async (_event, payload) => {
  const { baseUrl, token, eventPayload } = payload;
  const url = buildUrl(baseUrl, "/api/agent/events");
  return requestJson("POST", url, token, eventPayload);
});

ipcMain.handle("agent:openBrowser", async (_event, payload) => {
  const { baseUrl, token, importacionId, url } = payload;
  if (!importacionId) {
    throw new Error("Missing importacion_id");
  }
  if (!url) {
    throw new Error("Missing browser URL");
  }

  if (!browser) {
    browser = await chromium.launch({ headless: false });
  }

  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });

  const eventPayload = {
    importacion_id: importacionId,
    step: "browser_open",
    status: "ok",
    message: `Opened browser at ${url}`,
    ts: new Date().toISOString()
  };

  const eventUrl = buildUrl(baseUrl, "/api/agent/events");
  const eventResponse = await requestJson("POST", eventUrl, token, eventPayload);

  return {
    browser: "opened",
    url,
    event: eventResponse
  };
});

app.whenReady().then(createWindow);

app.on("window-all-closed", async () => {
  if (browser) {
    await browser.close();
    browser = null;
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
