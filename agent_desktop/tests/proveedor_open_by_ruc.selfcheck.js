const assert = require("assert");
const { chromium } = require("playwright");
const { clickTableCellLink } = require("../step_clicks");

const RUC = "1792049504001";

const HTML = `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>proveedor_open_by_ruc selfcheck</title>
  </head>
  <body>
    <script>window.clicked = "";</script>
    <table id="anchoDoc">
      <tbody>
        <tr onclick="window.clicked = 'row-${RUC}'">
          <td onclick="event.stopPropagation(); window.clicked = 'cell-${RUC}'">${RUC}</td>
          <td>Razon Social</td>
          <td><a href="#" onclick="window.clicked = 'row-${RUC}'">Abrir</a></td>
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
      cellIndex: 0,
      cellText: RUC,
      match: "exact",
      targetSelectors: ["css=a"]
    },
    5000
  );

  const clicked = await page.evaluate(() => window.clicked || "");
  assert.strictEqual(clicked, `cell-${RUC}`);

  await browser.close();
  console.log("proveedor_open_by_ruc.selfcheck ok");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
