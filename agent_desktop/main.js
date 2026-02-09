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

function normText(value) {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value).replace(/\s+/g, " ").trim().toLowerCase();
}

function clipLog(value, max = 200) {
  if (!value) {
    return "";
  }
  const text = String(value);
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}...`;
}

async function findRowByText(tableLocator, rowText, timeout, logPrefix) {
  const target = normText(rowText);
  if (!target) {
    throw new Error(`${logPrefix} rowText empty or invalid.`);
  }

  let rows = tableLocator.locator("tbody tr");
  let rowCount = await rows.count();
  if (rowCount === 0) {
    rows = tableLocator.locator("tr");
    rowCount = await rows.count();
  }

  console.log(`[${logPrefix}] rows found=${rowCount}`);

  const summaries = [];
  let matchedIndex = -1;

  for (let i = 0; i < rowCount; i += 1) {
    const row = rows.nth(i);
    let rawText = "";
    try {
      rawText = await row.innerText({ timeout });
    } catch (error) {
      rawText = "";
    }
    const normalized = normText(rawText);
    summaries.push(`#${i}:${clipLog(normalized)}`);
    if (matchedIndex === -1 && normalized.includes(target)) {
      matchedIndex = i;
    }
  }

  console.log(`[${logPrefix}] row texts: ${summaries.join(" | ")}`);

  if (matchedIndex === -1) {
    throw new Error(`${logPrefix} rowText not found: "${rowText}"`);
  }

  const matchedRow = rows.nth(matchedIndex);

  console.log(`[${logPrefix}] matched row index=${matchedIndex}`);

  return { row: matchedRow, rowIndex: matchedIndex, rowCount };
}

async function assertOnPage(page, step, timeout) {
  const urlPattern = step.urlPattern;
  const selector = step.selector;
  const anyText = step.anyText;

  if (!urlPattern && !selector && !anyText) {
    throw new Error("assertOnPage requiere urlPattern, selector o anyText.");
  }

  console.log(
    `[assertOnPage] url=${page.url()} | urlPattern=${urlPattern || "n/a"} | selector=${selector || "n/a"} | anyText=${
      Array.isArray(anyText) ? JSON.stringify(anyText) : "n/a"
    }`
  );

  const errors = [];

  if (urlPattern) {
    let regex = null;
    try {
      regex = new RegExp(urlPattern);
    } catch (error) {
      throw new Error(`assertOnPage urlPattern invalido: ${urlPattern}`);
    }
    const currentUrl = page.url();
    const match = regex.test(currentUrl);
    console.log(`[assertOnPage] urlPattern match=${match} currentUrl=${currentUrl}`);
    if (!match) {
      errors.push(`URL no coincide con /${urlPattern}/`);
    }
  }

  if (selector) {
    const locator = page.locator(selector).first();
    let selectorError = null;
    try {
      await locator.waitFor({ state: "visible", timeout });
    } catch (error) {
      selectorError = error;
    }
    let count = 0;
    let visible = false;
    try {
      count = await locator.count();
      if (count > 0) {
        visible = await locator.isVisible();
      }
    } catch (error) {
      count = 0;
      visible = false;
    }
    console.log(
      `[assertOnPage] selector=${selector} count=${count} visible=${visible}`
    );
    if (selectorError || !count || !visible) {
      errors.push(`Selector no visible: ${selector}`);
    }
  }

  if (anyText !== undefined && anyText !== null) {
    if (!Array.isArray(anyText)) {
      throw new Error("assertOnPage anyText debe ser array.");
    }
    const normalizedTexts = anyText
      .map((entry) => normText(entry))
      .filter((entry) => entry);
    if (!normalizedTexts.length) {
      throw new Error("assertOnPage anyText vacio.");
    }
    let bodyText = "";
    try {
      const raw = await page.textContent("body", { timeout });
      bodyText = normText(raw || "");
    } catch (error) {
      bodyText = "";
    }
    const matches = normalizedTexts.map((text) => ({
      text,
      matched: bodyText.includes(text)
    }));
    const matchedAny = matches.some((entry) => entry.matched);
    console.log(
      `[assertOnPage] anyText matches=${JSON.stringify(matches)}`
    );
    if (!matchedAny) {
      errors.push(`Texto esperado no encontrado: ${JSON.stringify(anyText)}`);
    }
  }

  if (errors.length) {
    throw new Error(`assertOnPage failed: ${errors.join(" | ")}`);
  }
}

async function clickRowAction(page, step, timeout) {
  requireValue(step.table, "step.table");
  requireValue(step.rowText, "step.rowText");
  if (!Array.isArray(step.actionSelectors) || step.actionSelectors.length === 0) {
    throw new Error("clickRowAction actionSelectors debe ser array no vacio.");
  }

  console.log(
    `[clickRowAction] table=${step.table} rowText="${step.rowText}" selectors=${JSON.stringify(
      step.actionSelectors
    )}`
  );

  const table = page.locator(step.table).first();
  await table.waitFor({ state: "attached", timeout });
  const { row } = await findRowByText(table, step.rowText, timeout, "clickRowAction");

  for (const selector of step.actionSelectors) {
    const locator = row.locator(selector).first();
    let count = 0;
    let visible = false;
    let enabled = false;
    try {
      count = await locator.count();
      if (count > 0) {
        visible = await locator.isVisible();
        enabled = await locator.isEnabled();
      }
    } catch (error) {
      count = 0;
    }

    console.log(
      `[clickRowAction] trying selector=${selector} count=${count} visible=${visible} enabled=${enabled}`
    );

    if (!count) {
      continue;
    }

    try {
      await locator.scrollIntoViewIfNeeded({ timeout });
    } catch (error) {
      const detail =
        error && (error.name || error.message)
          ? error.name || error.message
          : String(error);
      console.log(`[clickRowAction] scroll failed: ${selector} - ${detail}`);
    }

    try {
      await locator.click({ timeout, force: true });
      console.log(`[clickRowAction] clicked via locator.click: ${selector}`);
      return;
    } catch (error) {
      const detail =
        error && (error.name || error.message)
          ? error.name || error.message
          : String(error);
      console.log(`[clickRowAction] click failed: ${selector} - ${detail}`);
    }

    try {
      await locator.evaluate((el) => el.click());
      console.log(`[clickRowAction] clicked via evaluate: ${selector}`);
      return;
    } catch (error) {
      const detail =
        error && (error.name || error.message)
          ? error.name || error.message
          : String(error);
      console.log(`[clickRowAction] evaluate failed: ${selector} - ${detail}`);
    }
  }

  throw new Error(`clickRowAction: none worked: ${JSON.stringify(step.actionSelectors)}`);
}

async function clickTableCellLink(page, step, timeout) {
  requireValue(step.table, "step.table");
  requireValue(step.rowText, "step.rowText");

  const linkSelectors =
    Array.isArray(step.linkSelectors) && step.linkSelectors.length
      ? step.linkSelectors
      : ["a", "button"];

  console.log(
    `[clickTableCellLink] table=${step.table} rowText="${step.rowText}" cellIndex=${
      step.cellIndex === undefined || step.cellIndex === null ? "n/a" : step.cellIndex
    } linkSelectors=${JSON.stringify(linkSelectors)}`
  );

  const table = page.locator(step.table).first();
  await table.waitFor({ state: "attached", timeout });
  const { row } = await findRowByText(table, step.rowText, timeout, "clickTableCellLink");

  let scope = row;
  if (step.cellIndex !== undefined && step.cellIndex !== null) {
    const cells = row.locator("td,th");
    const cellCount = await cells.count();
    console.log(`[clickTableCellLink] cellCount=${cellCount}`);
    if (step.cellIndex < 0 || step.cellIndex >= cellCount) {
      throw new Error(
        `clickTableCellLink: cellIndex ${step.cellIndex} fuera de rango (0-${Math.max(
          0,
          cellCount - 1
        )})`
      );
    }
    scope = cells.nth(step.cellIndex);
  }

  for (const selector of linkSelectors) {
    const candidates = scope.locator(selector);
    const count = await candidates.count();
    console.log(`[clickTableCellLink] scanning selector=${selector} count=${count}`);
    for (let i = 0; i < count; i += 1) {
      const candidate = candidates.nth(i);
      let visible = false;
      try {
        visible = await candidate.isVisible();
      } catch (error) {
        visible = false;
      }
      if (!visible) {
        continue;
      }

      try {
        await candidate.scrollIntoViewIfNeeded({ timeout });
      } catch (error) {
        const detail =
          error && (error.name || error.message)
            ? error.name || error.message
            : String(error);
        console.log(`[clickTableCellLink] scroll failed: ${selector} - ${detail}`);
      }

      try {
        await candidate.click({ timeout, force: true });
        console.log(
          `[clickTableCellLink] clicked selector=${selector} index=${i}`
        );
        return;
      } catch (error) {
        const detail =
          error && (error.name || error.message)
            ? error.name || error.message
            : String(error);
        console.log(`[clickTableCellLink] click failed: ${selector} - ${detail}`);
      }

      try {
        await candidate.evaluate((el) => el.click());
        console.log(
          `[clickTableCellLink] clicked via evaluate selector=${selector} index=${i}`
        );
        return;
      } catch (error) {
        const detail =
          error && (error.name || error.message)
            ? error.name || error.message
            : String(error);
        console.log(`[clickTableCellLink] evaluate failed: ${selector} - ${detail}`);
      }
    }
  }

  throw new Error(
    `clickTableCellLink: no se encontro link/button visible. selectors=${JSON.stringify(
      linkSelectors
    )}`
  );
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
  const periodoTarget =
    (action && (action.periodoTarget || action.periodo_target || action.periodo)) || "";
  return buildActionContext(action, {
    target_url_login: config && config.target_url_login ? config.target_url_login : "",
    periodoTarget
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
      case "assertOnPage":
        await assertOnPage(page, step, timeout);
        break;
      case "clickRowAction":
        await clickRowAction(page, step, timeout);
        break;
      case "clickTableCellLink":
        await clickTableCellLink(page, step, timeout);
        break;
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
      case "clickAny": {
        if (!Array.isArray(step.selectors) || step.selectors.length === 0) {
          throw new Error("step.selectors must be a non-empty array.");
        }
        const timeout = step.timeout ?? 30000;
        let clicked = false;

        for (const selector of step.selectors) {
          const locator = page.locator(selector).first();
          let count = 0;
          let isVisible = false;
          let isEnabled = false;
          let box;
          try {
            count = await locator.count();
            if (count > 0) {
              isVisible = await locator.isVisible();
              isEnabled = await locator.isEnabled();
              try {
                const measured = await locator.boundingBox();
                if (measured !== null) {
                  box = measured;
                }
              } catch (_boxError) {
                // Keep previous box if any; don't overwrite with null.
              }
            }
          } catch (probeError) {
            count = 0;
          }
          console.log(
            `[clickAny] trying: ${selector} | count=${count} | visible=${isVisible} | enabled=${isEnabled} | box=${box !== undefined ? JSON.stringify(box) : "unavailable"}`
          );
          if (!count || !isEnabled) {
            continue;
          }

          try {
            await locator.scrollIntoViewIfNeeded({ timeout });
          } catch (scrollError) {
            const detail =
              scrollError && (scrollError.name || scrollError.message)
                ? scrollError.name || scrollError.message
                : String(scrollError);
            console.log(`[clickAny] scroll failed: ${selector} - ${detail}`);
          }

          try {
            if (!isVisible) {
              console.log(`[clickAny] not visible, attempting force click: ${selector}`);
            }
            await locator.click({ timeout, force: true });
            console.log(`[clickAny] clicked via locator.click: ${selector}`);
            if (step.logUrlAfter) {
              console.log(`[clickAny] url(after)=${page.url()}`);
            }
            clicked = true;
            break;
          } catch (error) {
            const detail =
              error && (error.name || error.message)
                ? error.name || error.message
                : String(error);
            console.log(`[clickAny] click failed: ${selector} - ${detail}`);
          }

          try {
            await locator.evaluate((el) => el.click());
            console.log(`[clickAny] clicked via evaluate: ${selector}`);
            if (step.logUrlAfter) {
              console.log(`[clickAny] url(after)=${page.url()}`);
            }
            clicked = true;
            break;
          } catch (error) {
            const detail =
              error && (error.name || error.message)
                ? error.name || error.message
                : String(error);
            console.log(`[clickAny] evaluate failed: ${selector} - ${detail}`);
          }

          try {
            await locator.dispatchEvent("click");
            console.log(`[clickAny] clicked via dispatchEvent: ${selector}`);
            if (step.logUrlAfter) {
              console.log(`[clickAny] url(after)=${page.url()}`);
            }
            clicked = true;
            break;
          } catch (error) {
            const detail =
              error && (error.name || error.message)
                ? error.name || error.message
                : String(error);
            console.log(`[clickAny] dispatchEvent failed: ${selector} - ${detail}`);
          }
        }

        if (!clicked) {
          throw new Error(`clickAny: none worked: ${JSON.stringify(step.selectors)}`);
        }

        break;
      }
      case "trySteps": {
        if (!Array.isArray(step.steps) || step.steps.length === 0) {
          throw new Error("trySteps.steps must be a non-empty array.");
        }
        if (!Array.isArray(step.fallbackSteps) || step.fallbackSteps.length === 0) {
          throw new Error("trySteps.fallbackSteps must be a non-empty array.");
        }
        if (step.log) {
          console.log(`[trySteps] ${step.log}`);
        }

        let primaryError = null;
        try {
          await runStepSequence(step.steps, context, options);
          break;
        } catch (error) {
          primaryError = error;
          const detail =
            error && (error.name || error.message)
              ? error.name || error.message
              : String(error);
          console.log(`[trySteps] primary failed -> running fallback: ${detail}`);
        }

        try {
          await runStepSequence(step.fallbackSteps, context, options);
        } catch (fallbackError) {
          const primaryDetail =
            primaryError && (primaryError.name || primaryError.message)
              ? primaryError.name || primaryError.message
              : String(primaryError);
          const fallbackDetail =
            fallbackError && (fallbackError.name || fallbackError.message)
              ? fallbackError.name || fallbackError.message
              : String(fallbackError);
          throw new Error(
            `trySteps failed. primary=${primaryDetail} | fallback=${fallbackDetail}`
          );
        }
        break;
      }
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
      case "ensureSidebarOpen": {
        requireValue(step.hamburger, "step.hamburger");

        // IDs reales del SRI (según tus capturas)
        const sidebar1 = step.sidebar1 || "#mySidebar";
        const sidebar2 = step.sidebar2 || "#mySidebar2";
        const minWidth = 200;

        console.log(`[step_runner] ensureSidebarOpen url(before)=${page.url()}`);
        const alreadyOpen = await page
          .evaluate(({ s1, s2, minW }) => {
            const read = (sel) => {
              const el = document.querySelector(sel);
              if (!el) {
                return { display: null, width: 0 };
              }
              return {
                display: window.getComputedStyle(el).display,
                width: el.getBoundingClientRect().width
              };
            };
            const info1 = read(s1);
            const info2 = read(s2);
            const open1 = info1.display && info1.display !== "none" && info1.width >= minW;
            const open2 = info2.display && info2.display !== "none" && info2.width >= minW;
            return Boolean(open1 || open2);
          }, { s1: sidebar1, s2: sidebar2, minW: minWidth })
          .catch(() => false);
        if (alreadyOpen) {
          console.log("[step_runner] sidebar already open (computed style)");
          break;
        }

        // Click al hamburguesa (toggle)
        await page.click(step.hamburger, { timeout });

        // Esperar a que alguno quede visible por computed style y ancho suficiente
        await page.waitForFunction(
          ({ s1, s2, minW }) => {
            const el1 = document.querySelector(s1);
            const el2 = document.querySelector(s2);
            const v1 = el1 && window.getComputedStyle(el1).display !== "none";
            const v2 = el2 && window.getComputedStyle(el2).display !== "none";
            const w1 = el1 ? el1.getBoundingClientRect().width : 0;
            const w2 = el2 ? el2.getBoundingClientRect().width : 0;
            return Boolean((v1 && w1 >= minW) || (v2 && w2 >= minW));
          },
          { s1: sidebar1, s2: sidebar2, minW: minWidth },
          { timeout }
        );

        console.log(`[step_runner] ensureSidebarOpen url(after)=${page.url()}`);
        console.log("[step_runner] sidebar opened (computed style)");
        break;
      }


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

async function runProviderOpenByRuc(config, action, ruc) {
  const steps =
    config && config.proveedor_open_by_ruc
      ? config.proveedor_open_by_ruc.steps
      : null;
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error("Config requerida: proveedor_open_by_ruc.steps");
  }
  const context = buildActionContext(action, { ruc });
  return runStepSequence(steps, context);
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
  try {
    return await runStep(
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
          logs: result?.logs ?? []
        };
      }
    );
  } catch (error) {
    const url = state.page ? state.page.url() : null;
    const errorMessage = error && error.message ? error.message : String(error);
    const fullError = url ? `${errorMessage} | url=${url}` : errorMessage;
    return {
      result: {
        ok: false,
        step: "provider_open",
        error: fullError,
        logs: []
      },
      event: null,
      eventPayload: null
    };
  }
});

ipcMain.handle("agent:providerOpenByRuc", async (_event, payload) => {
  const { baseUrl, token, importacionId, ruc } = payload;
  const trimmedRuc = ruc ? String(ruc).trim() : "";
  const currentAction = getCurrentAction(state.plan, state.planIndex) || {};
  const proveedorLabel =
    trimmedRuc || currentAction.proveedor_ruc || currentAction.proveedor_id || "N/A";
  const eventExtra = trimmedRuc ? { ruc: trimmedRuc } : {};
  try {
    return await runStep(
      {
        baseUrl,
        token,
        importacionId,
        step: "provider_open_by_ruc",
        message: `Proveedor abierto por RUC (${proveedorLabel}).`,
        eventExtra
      },
      async () => {
        const action = ensureAssistedPreconditions();
        if (!trimmedRuc) {
          throw new Error("provider_open_by_ruc requiere ruc.");
        }
        console.log(`provider_open_by_ruc: ruc=${trimmedRuc}`);
        const config = await requireConfigForAction("proveedor_open_by_ruc");
        const result = await runProviderOpenByRuc(config, action, trimmedRuc);
        return {
          snapshot: getStateSnapshot(),
          logs: result?.logs ?? []
        };
      }
    );
  } catch (error) {
    const url = state.page ? state.page.url() : null;
    const errorMessage = error && error.message ? error.message : String(error);
    const fullError = url ? `${errorMessage} | url=${url}` : errorMessage;
    return {
      result: {
        ok: false,
        step: "provider_open_by_ruc",
        error: fullError,
        logs: []
      },
      event: null,
      eventPayload: null
    };
  }
});

ipcMain.handle("agent:invoiceOpen", async (_event, payload) => {
  const { baseUrl, token, importacionId } = payload;
  const currentAction = getCurrentAction(state.plan, state.planIndex) || {};
  const facturaLabel =
    currentAction.clave_acceso || currentAction.factura_id || "N/A";
  const eventExtra = currentAction.factura_id ? { factura_id: currentAction.factura_id } : {};
  try {
    return await runStep(
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
          logs: result?.logs ?? []
        };
      }
    );
  } catch (error) {
    const url = state.page ? state.page.url() : null;
    const errorMessage = error && error.message ? error.message : String(error);
    const fullError = url ? `${errorMessage} | url=${url}` : errorMessage;
    return {
      result: {
        ok: false,
        step: "invoice_open",
        error: fullError,
        logs: []
      },
      event: null,
      eventPayload: null
    };
  }
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
