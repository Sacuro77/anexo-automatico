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

const segments = [
  { action: "provider_open", urlPattern: "anexos\\.jsf" },
  { action: "anexo_period_ensure", urlPattern: "editar-anexo\\.jsf", requireVars: ["periodoTarget"] },
  { action: "anexo_open_facturas_electronicas", urlPattern: "facturas-electronicas-agrupadas\\.jsf" },
  { action: "proveedor_open_by_ruc", urlPattern: "facturas-electronicas\\.jsf\\?emisor=", requireVars: ["ruc"] },
  { action: "invoice_open_by_clave", urlPattern: "facturas-electronicas\\.jsf\\?.*(clave|claveAcceso)=", requireVars: ["claveAcceso"] }
];

let cursor = 0;
for (const segment of segments) {
  const actionIndex = findStepIndex(
    cursor,
    (step) => step.type === "runAction" && getActionName(step) === segment.action
  );
  assert(actionIndex >= 0, `Missing runAction for ${segment.action}`);

  if (segment.requireVars) {
    for (const key of segment.requireVars) {
      const vars = steps[actionIndex].vars || {};
      assert(
        Object.prototype.hasOwnProperty.call(vars, key),
        `runAction ${segment.action} missing vars.${key}`
      );
    }
  }

  const assertIndex = findStepIndex(
    actionIndex + 1,
    (step) => step.type === "assertOnPage"
  );
  assert(assertIndex >= 0, `Missing assertOnPage after ${segment.action}`);
  const pattern = steps[assertIndex].urlPattern || "";
  assert(
    pattern.includes(segment.urlPattern),
    `Expected urlPattern ${segment.urlPattern} after ${segment.action}, got ${pattern}`
  );
  cursor = assertIndex + 1;
}

const applyPrepareIndex = findStepIndex(cursor, (step) => step.type === "applyPrepare");
assert(applyPrepareIndex >= 0, "Missing applyPrepare step");
const applyConfirmIndex = findStepIndex(
  applyPrepareIndex + 1,
  (step) => step.type === "applyConfirm"
);
assert(applyConfirmIndex >= 0, "Missing applyConfirm step");

console.log("e2e_from_profile.selfcheck ok");
