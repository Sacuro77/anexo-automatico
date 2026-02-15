const assert = require("assert");
const fs = require("fs");
const path = require("path");

const configPath = path.join(__dirname, "..", "sri_flow_config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

const actionName = "e2e_from_profile_assisted";
const action = config[actionName];
assert(action, `Missing action: ${actionName}`);
assert(
  Array.isArray(action.steps) && action.steps.length > 0,
  `Action ${actionName} missing steps`
);

const steps = action.steps;

function getActionName(step) {
  return step.actionName || step.action || step.name || "";
}

function findStepIndex(startIndex, predicate) {
  for (let i = startIndex; i < steps.length; i += 1) {
    if (predicate(steps[i])) {
      return i;
    }
  }
  return -1;
}

const firstStep = steps[0];
assert(firstStep && firstStep.type === "assertOnPage", "First step must assert on profile");
assert(
  firstStep.urlPattern && firstStep.urlPattern.includes("contribuyente\/perfil"),
  "First step should target /contribuyente/perfil"
);

const providerOpenIndex = findStepIndex(
  0,
  (step) => step.type === "runAction" && getActionName(step) === "provider_open"
);
assert(providerOpenIndex >= 0, "Missing runAction for provider_open");

const proveedorByRucIndex = findStepIndex(
  providerOpenIndex + 1,
  (step) => step.type === "runAction" && getActionName(step) === "proveedor_open_by_ruc"
);
assert(proveedorByRucIndex >= 0, "Missing runAction for proveedor_open_by_ruc");
const proveedorVars = steps[proveedorByRucIndex].vars || {};
assert(
  Object.prototype.hasOwnProperty.call(proveedorVars, "ruc"),
  "runAction proveedor_open_by_ruc missing vars.ruc"
);

const facturasAssertIndex = findStepIndex(
  proveedorByRucIndex + 1,
  (step) => step.type === "assertOnPage"
);
assert(facturasAssertIndex >= 0, "Missing assertOnPage after proveedor_open_by_ruc");
const facturasPattern = steps[facturasAssertIndex].urlPattern || "";
assert(
  facturasPattern.includes("facturas-electronicas\\.jsf\\?emisor="),
  `Expected facturas-electronicas.jsf?emisor= after proveedor_open_by_ruc, got ${facturasPattern}`
);

const markCategoryIndex = findStepIndex(
  facturasAssertIndex + 1,
  (step) => step.type === "runAction" && getActionName(step) === "invoice_mark_category_by_numero"
);
assert(markCategoryIndex >= 0, "Missing runAction for invoice_mark_category_by_numero");

const markVars = steps[markCategoryIndex].vars || {};
for (const key of ["numero_factura", "categoria_panel", "categoria_label"]) {
  assert(
    Object.prototype.hasOwnProperty.call(markVars, key),
    `runAction invoice_mark_category_by_numero missing vars.${key}`
  );
}

const postMarkAssertIndex = findStepIndex(
  markCategoryIndex + 1,
  (step) => step.type === "assertOnPage"
);
assert(postMarkAssertIndex >= 0, "Missing assertOnPage after invoice_mark_category_by_numero");
const postMarkPattern = steps[postMarkAssertIndex].urlPattern || "";
assert(
  postMarkPattern.includes("facturas-electronicas\\.jsf"),
  `Expected to remain on facturas-electronicas.jsf after categorization, got ${postMarkPattern}`
);

const markAction = config.invoice_mark_category_by_numero;
assert(markAction && Array.isArray(markAction.steps), "Missing invoice_mark_category_by_numero config");

const waitByPanel = markAction.steps.find(
  (step) =>
    step.type === "trySteps" &&
    Array.isArray(step.steps) &&
    step.steps.some(
      (inner) =>
        inner.type === "waitForSelector" &&
        typeof inner.selector === "string" &&
        inner.selector.includes("FACTURA {{numero_factura}}") &&
        inner.selector.includes("panel:{{categoria_panel}}:campo")
    )
);
assert(waitByPanel, "invoice_mark_category_by_numero missing FACTURA-scoped wait by categoria_panel");

const waitByLabelFallback = markAction.steps.find(
  (step) =>
    step.type === "trySteps" &&
    Array.isArray(step.fallbackSteps) &&
    step.fallbackSteps.some(
      (fallback) =>
        fallback.type === "waitForSelector" &&
        typeof fallback.selector === "string" &&
        fallback.selector.includes("FACTURA {{numero_factura}}") &&
        fallback.selector.includes("div.form-group:has(label:has-text('{{categoria_label}}'))") &&
        fallback.selector.includes("button.btn.btn-sm.btn-primary")
    )
);
assert(waitByLabelFallback, "invoice_mark_category_by_numero missing FACTURA-scoped fallback by categoria_label");

const clickCategory = markAction.steps.find((step) => step.type === "clickAny");
assert(clickCategory && Array.isArray(clickCategory.selectors), "Missing clickAny selectors for invoice_mark_category_by_numero");
assert(
  clickCategory.selectors.some(
    (selector) =>
      typeof selector === "string" &&
      selector.includes("FACTURA {{numero_factura}}") &&
      selector.includes("panel:{{categoria_panel}}:campo")
  ),
  "clickAny missing FACTURA-scoped selector by categoria_panel"
);
assert(
  clickCategory.selectors.some(
    (selector) =>
      typeof selector === "string" &&
      selector.includes("FACTURA {{numero_factura}}") &&
      selector.includes("div.form-group:has(label:has-text('{{categoria_label}}'))") &&
      selector.includes("button.btn.btn-sm.btn-primary")
  ),
  "clickAny missing FACTURA-scoped fallback selector by categoria_label"
);

assert(
  findStepIndex(0, (step) => step.type === "runAction" && getActionName(step) === "invoice_open_by_clave") === -1,
  "e2e_from_profile_assisted should not require invoice_open_by_clave"
);

assert(
  findStepIndex(postMarkAssertIndex, (step) => step.type === "applyPrepare") === -1,
  "e2e_from_profile_assisted should not run applyPrepare in this flow"
);

const saveClickIndex = findStepIndex(
  postMarkAssertIndex + 1,
  (step) => step.type === "clickAny" && Array.isArray(step.selectors)
);
assert(saveClickIndex >= 0, "Missing clickAny step for Guardar");
const saveSelectors = steps[saveClickIndex].selectors;
assert(
  saveSelectors.some(
    (selector) => typeof selector === "string" && selector.includes("input[type='submit'][value='Guardar']")
  ),
  "Guardar click step missing stable submit selector"
);
assert(
  saveSelectors.some(
    (selector) => typeof selector === "string" && selector.includes("button:has-text('Guardar')")
  ),
  "Guardar click step missing button text selector"
);

const finalizeWaitIndex = findStepIndex(
  saveClickIndex + 1,
  (step) => step.type === "trySteps" && Array.isArray(step.steps)
);
assert(finalizeWaitIndex >= 0, "Missing post-guardar finalization step");

console.log("e2e_from_profile.selfcheck ok");
