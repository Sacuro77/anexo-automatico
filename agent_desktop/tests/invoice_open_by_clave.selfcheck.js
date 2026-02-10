const assert = require("assert");
const { chromium } = require("playwright");
const { clickTableCellLink } = require("../step_clicks");

const CLAVE = "1234567890123456789012345678901234567890123456789";

const HTML = `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>invoice_open_by_clave selfcheck</title>
  </head>
  <body>
    <script>window.clicked = "";</script>
    <table id="anchoDoc">
      <tbody>
        <tr>
          <td>Factura A</td>
          <td>${CLAVE} <a href="#" onclick="window.clicked = 'anchor-${CLAVE}'">Abrir</a></td>
          <td>Total</td>
        </tr>
        <tr>
          <td>Factura B</td>
          <td>0000000000000000000000000000000000000000000000000</td>
          <td>Total</td>
        </tr>
      </tbody>
    </table>
  </body>
</html>
`;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.setContent(HTML, { waitUntil: "domcontentloaded" });

  await clickTableCellLink(
    page,
    {
      table: "css=table#anchoDoc",
      cellIndex: 1,
      cellText: CLAVE,
      match: "includes",
      targetSelectors: ["css=a"]
    },
    5000
  );

  const clicked = await page.evaluate(() => window.clicked || "");
  assert.strictEqual(clicked, `anchor-${CLAVE}`);

  await browser.close();
  console.log("invoice_open_by_clave.selfcheck ok");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
