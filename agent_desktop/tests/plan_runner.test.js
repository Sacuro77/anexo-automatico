const assert = require("assert");
const {
  buildActionContext,
  getActionsFromPlan,
  getCurrentAction,
  interpolateTemplate,
  resolveCategoryOption,
  validateConfigForAction,
  validateFlowConfig,
} = require("../step_runner");

const planAcciones = { acciones: [{ factura_id: 1 }, { factura_id: 2 }] };
assert.strictEqual(getActionsFromPlan(planAcciones).length, 2);

const planActions = { actions: [{ factura_id: 9 }] };
assert.strictEqual(getActionsFromPlan(planActions).length, 1);

assert.strictEqual(getCurrentAction(planAcciones, 0).factura_id, 1);
assert.strictEqual(getCurrentAction(planAcciones, 5).factura_id, 2);

const context = buildActionContext({
  factura_id: 10,
  categoria_nombre: "Servicios",
  clave_acceso: "ABC",
});
assert.strictEqual(context.categoria_objetivo, "Servicios");
assert.strictEqual(
  interpolateTemplate("{{factura_id}}-{{categoria_objetivo}}", context),
  "10-Servicios"
);

const categoryMap = {
  "123": { value: "123" },
  Servicios: { label: "Servicios" },
};
assert.deepStrictEqual(resolveCategoryOption("123", categoryMap), { value: "123" });
assert.deepStrictEqual(resolveCategoryOption("Servicios", categoryMap), {
  label: "Servicios",
});

const config = {
  provider_open: { steps: [{ type: "click", selector: "#a" }] },
  invoice_open: { steps: [] },
  apply: {
    category_selector: "#cat",
    confirm_selector: "#save",
    category_map: { "1": { value: "1" } },
  },
};
assert.strictEqual(validateConfigForAction(config, "provider_open").ok, true);
assert.strictEqual(validateConfigForAction(config, "invoice_open").ok, false);
assert.strictEqual(validateFlowConfig(config).ok, false);

console.log("plan_runner.test.js ok");
