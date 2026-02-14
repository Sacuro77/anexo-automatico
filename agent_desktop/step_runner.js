const VALID_CATEGORY_MODES = new Set(["select", "fill", "click"]);

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
  return {
    proveedor_id: action.proveedor_id || "",
    proveedor_ruc: action.proveedor_ruc || "",
    factura_id: action.factura_id || "",
    clave_acceso: action.clave_acceso || "",
    categoria_id: action.categoria_id || "",
    categoria_nombre: action.categoria_nombre || "",
    categoria_objetivo: categoriaObjetivo,
    periodoTarget,
    confianza: action.confianza || "",
    ...extras
  };
}

function interpolateTemplate(value, context, options = {}) {
  if (typeof value !== "string") {
    return value;
  }
  const onMissingVar = options && typeof options.onMissingVar === "function"
    ? options.onMissingVar
    : null;
  return value.replace(/{{\s*([\w.-]+)\s*}}/g, (_match, key) => {
    if (!context || typeof context !== "object") {
      if (onMissingVar) {
        onMissingVar(key, value);
      }
      return "";
    }
    const resolved = context[key];
    if (resolved === undefined || resolved === null) {
      if (onMissingVar) {
        onMissingVar(key, value);
      }
      return "";
    }
    return String(resolved);
  });
}

function interpolateDeep(value, context, options = {}) {
  if (typeof value === "string") {
    return interpolateTemplate(value, context, options);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => interpolateDeep(entry, context, options));
  }
  if (value && typeof value === "object") {
    const next = {};
    for (const [key, entry] of Object.entries(value)) {
      next[key] = interpolateDeep(entry, context, options);
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
