const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const configPath = path.join(__dirname, "..", "sri_flow_config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const apply = config.apply;

const HTML = `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>apply categoria selfcheck</title>
  </head>
  <body>
    <script>
      window.copied = false;
      window.saved = false;
    </script>
    <section id="categorias">
      <h2>Categorías</h2>
      <button class="btn-primary" onclick="window.copied = true;">Copiar subtotal</button>
      <select id="categoria">
        <option value="">-- Selecciona --</option>
        <option value="123">Categoria Ejemplo</option>
      </select>
      <button id="guardar" onclick="
        window.saved = true;
        const toast = document.getElementById('toast');
        toast.textContent = 'Guardado';
        toast.style.display = 'block';
      ">Guardar</button>
      <div id="toast" class="ui-growl-message" style="display:none;"></div>
    </section>
  </body>
</html>
`;

async function clickAny(page, selectors, timeout = 5000) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
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
    if (!count || !visible) {
      continue;
    }
    await locator.click({ timeout, force: true });
    return selector;
  }
  throw new Error("clickAny: no selector matched");
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(HTML, { waitUntil: "domcontentloaded" });

  await page.waitForSelector(apply.category_selector, { timeout: 5000 });

  const copyStep = (apply.steps_before_confirm || []).find(
    (step) => step.type === "clickAny"
  );
  if (!copyStep || !Array.isArray(copyStep.selectors)) {
    throw new Error("apply.steps_before_confirm missing clickAny selectors");
  }
  await clickAny(page, copyStep.selectors);

  const categoryLabel = "Categoria Ejemplo";
  await page.selectOption(apply.category_selector, { label: categoryLabel });

  await page.click(apply.confirm_selector, { timeout: 5000 });
  await page.waitForSelector(apply.confirm_success_selector, { timeout: 5000 });

  const copied = await page.evaluate(() => window.copied);
  const saved = await page.evaluate(() => window.saved);
  assert.strictEqual(copied, true);
  assert.strictEqual(saved, true);

  await browser.close();
  console.log("apply_categoria.selfcheck ok");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
