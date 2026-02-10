const assert = require("assert");
const fs = require("fs");
const path = require("path");

const configPath = path.join(__dirname, "..", "sri_flow_config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

const requiredActions = [
  "provider_open",
  "anexo_period_ensure",
  "anexo_open_facturas_electronicas",
  "proveedor_open_by_ruc",
  "invoice_open_by_clave"
];

for (const actionName of requiredActions) {
  const action = config[actionName];
  assert(action, `Missing action: ${actionName}`);
  assert(
    Array.isArray(action.steps) && action.steps.length > 0,
    `Action ${actionName} missing steps`
  );
}

assert(config.apply, "Missing apply config");
assert(
  Array.isArray(config.apply.steps_before_confirm) &&
    config.apply.steps_before_confirm.length > 0,
  "apply.steps_before_confirm missing"
);
assert(config.apply.category_selector, "apply.category_selector missing");
assert(config.apply.confirm_selector, "apply.confirm_selector missing");

const hasCopyStep = config.apply.steps_before_confirm.some(
  (step) => step.type === "clickAny" && Array.isArray(step.selectors)
);
assert(hasCopyStep, "apply.steps_before_confirm missing clickAny selectors");

console.log("e2e_single_action.selfcheck ok");
