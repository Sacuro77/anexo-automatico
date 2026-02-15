const VALID_CATEGORY_MODES = new Set(["select", "fill", "click"]);
const CATEGORY_DETAILS_MAP = {
  SALUD: { panel: "salud", label: "Salud" },
  ALIMENTACION: { panel: "alimentacion", label: "Alimentación" },
  EDUCACION_ARTE_CULTURA: {
    panel: "educacion",
    label: "Educación, Arte y Cultura"
  },
  EDUCACION_ARTE_Y_CULTURA: {
    panel: "educacion",
    label: "Educación, Arte y Cultura"
  },
  TURISMO: { panel: "turismo", label: "Turismo" },
  VESTIMENTA: { panel: "vestimenta", label: "Vestimenta" },
  VIVIENDA: { panel: "vivienda", label: "Vivienda" }
};

function normalizeNumeroFactura(value) {
  if (value === undefined || value === null) {
    return "";
  }
  const raw = String(value).trim();
  if (!raw) {
    return "";
  }
  const grouped = raw.match(/(\d{3})\D*(\d{3})\D*(\d{9})/);
  if (grouped) {
    return `${grouped[1]}-${grouped[2]}-${grouped[3]}`;
  }
  const digitsOnly = raw.replace(/\D+/g, "");
  if (digitsOnly.length === 15) {
    return `${digitsOnly.slice(0, 3)}-${digitsOnly.slice(3, 6)}-${digitsOnly.slice(6, 15)}`;
  }
  return "";
}

function deriveNumeroFacturaFromClaveAcceso(claveAcceso) {
  if (claveAcceso === undefined || claveAcceso === null) {
    return "";
  }
  const digitsOnly = String(claveAcceso).replace(/\D+/g, "");
  if (digitsOnly.length !== 49) {
    return "";
  }
  const establecimiento = digitsOnly.slice(24, 27);
  const puntoEmision = digitsOnly.slice(27, 30);
  const secuencial = digitsOnly.slice(30, 39);
  if (!/^\d{3}$/.test(establecimiento) || !/^\d{3}$/.test(puntoEmision) || !/^\d{9}$/.test(secuencial)) {
    return "";
  }
  return `${establecimiento}-${puntoEmision}-${secuencial}`;
}

function resolveNumeroFactura(numeroFactura, claveAcceso) {
  const normalized = normalizeNumeroFactura(numeroFactura);
  if (normalized) {
    return normalized;
  }
  return deriveNumeroFacturaFromClaveAcceso(claveAcceso);
}

function normalizeCategoryKey(value) {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function resolveCategoryDetails(value) {
  const key = normalizeCategoryKey(value);
  if (!key) {
    return null;
  }
  return CATEGORY_DETAILS_MAP[key] || null;
}

function getActionsFromPlan(plan) {
  if (!plan || typeof plan !== "object") {
    return [];
  }
  if (Array.isArray(plan.acciones)) {
    return plan.acciones;
  }
  if (Array.isArray(plan.actions)) {
    return plan.actions;
  }
  return [];
}

function getCurrentAction(plan, index) {
  const actions = getActionsFromPlan(plan);
  if (!actions.length) {
    return null;
  }
  const safeIndex = Math.max(0, Math.min(index || 0, actions.length - 1));
  return actions[safeIndex] || null;
}

function buildActionContext(action = {}, extras = {}) {
  const categoriaObjetivo =
    action.categoria_objetivo || action.categoria_nombre || action.categoria_id || "";
  const periodoTarget =
    action.periodoTarget || action.periodo_target || action.periodo || "";
  const context = {
    proveedor_id: action.proveedor_id || "",
    proveedor_ruc: action.proveedor_ruc || "",
    factura_id: action.factura_id || "",
    clave_acceso: action.clave_acceso || "",
    categoria_id: action.categoria_id || "",
    categoria_nombre: action.categoria_nombre || "",
    categoria_objetivo: categoriaObjetivo,
    categoria_panel: "",
    categoria_label: "",
    periodoTarget,
    confianza: action.confianza || "",
    ...extras
  };
  const numeroFactura = resolveNumeroFactura(
    context.numero_factura || action.numero_factura || "",
    context.clave_acceso || action.clave_acceso || ""
  );
  context.numero_factura = numeroFactura;
  context.numero_factura_compacto = numeroFactura ? numeroFactura.replace(/-/g, "") : "";

  const details = resolveCategoryDetails(
    context.categoria_nombre || context.categoria_objetivo || context.categoria_id
  );
  if (!context.categoria_panel && details && details.panel) {
    context.categoria_panel = details.panel;
  }
  if (!context.categoria_label && details && details.label) {
    context.categoria_label = details.label;
  }
  return context;
}

function interpolateTemplate(value, context) {
  if (typeof value !== "string") {
    return value;
  }
  return value.replace(/{{\s*([\w.-]+)\s*}}/g, (_match, key) => {
    if (!context || typeof context !== "object") {
      return "";
    }
    const resolved = context[key];
    if (resolved === undefined || resolved === null) {
      return "";
    }
    return String(resolved);
  });
}

function interpolateDeep(value, context) {
  if (typeof value === "string") {
    return interpolateTemplate(value, context);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => interpolateDeep(entry, context));
  }
  if (value && typeof value === "object") {
    const next = {};
    for (const [key, entry] of Object.entries(value)) {
      next[key] = interpolateDeep(entry, context);
    }
    return next;
  }
  return value;
}

function resolveCategoryOption(categoryKey, categoryMap) {
  if (!categoryMap || typeof categoryMap !== "object") {
    return null;
  }
  const direct =
    categoryMap[categoryKey] !== undefined
      ? categoryMap[categoryKey]
      : categoryMap[String(categoryKey)];
  if (!direct) {
    return null;
  }
  if (typeof direct === "string") {
    return { label: direct };
  }
  if (typeof direct !== "object") {
    return null;
  }
  const option = {};
  if (direct.value) {
    option.value = String(direct.value);
  }
  if (direct.label) {
    option.label = String(direct.label);
  }
  if (direct.text) {
    option.text = String(direct.text);
  }
  return Object.keys(option).length ? option : null;
}

function validateConfigForAction(config, actionName) {
  const errors = [];
  if (!config || typeof config !== "object") {
    return { ok: false, errors: ["config missing"] };
  }

  if (actionName === "provider_open") {
    const steps = config.provider_open ? config.provider_open.steps : null;
    if (!Array.isArray(steps) || steps.length === 0) {
      errors.push("provider_open.steps");
    }
  }

  if (actionName === "invoice_open") {
    const steps = config.invoice_open ? config.invoice_open.steps : null;
    if (!Array.isArray(steps) || steps.length === 0) {
      errors.push("invoice_open.steps");
    }
  }

  if (actionName === "apply") {
    const apply = config.apply || {};
    if (!apply.category_selector) {
      errors.push("apply.category_selector");
    }
    if (!apply.confirm_selector) {
      errors.push("apply.confirm_selector");
    }
    if (!apply.category_map || typeof apply.category_map !== "object") {
      errors.push("apply.category_map");
    } else if (!Object.keys(apply.category_map).length) {
      errors.push("apply.category_map (empty)");
    }
    if (apply.category_mode && !VALID_CATEGORY_MODES.has(apply.category_mode)) {
      errors.push("apply.category_mode");
    }
    if (apply.category_mode === "click" && !apply.category_option_selector) {
      errors.push("apply.category_option_selector");
    }
  }

  return { ok: errors.length === 0, errors };
}

function validateFlowConfig(config) {
  const errors = [];
  const provider = validateConfigForAction(config, "provider_open");
  const invoice = validateConfigForAction(config, "invoice_open");
  const apply = validateConfigForAction(config, "apply");
  if (!provider.ok) {
    errors.push(...provider.errors);
  }
  if (!invoice.ok) {
    errors.push(...invoice.errors);
  }
  if (!apply.ok) {
    errors.push(...apply.errors);
  }
  return { ok: errors.length === 0, errors };
}

module.exports = {
  buildActionContext,
  getActionsFromPlan,
  getCurrentAction,
  interpolateDeep,
  interpolateTemplate,
  resolveCategoryOption,
  validateConfigForAction,
  validateFlowConfig,
};
