const assert = require("assert");
const { chromium } = require("playwright");
const { clickTableCellLink } = require("../step_clicks");

const HTML = `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>clickTableCellLink selfcheck</title>
    <style>
      table { border-collapse: collapse; }
      td, th { border: 1px solid #333; padding: 4px 8px; }
    </style>
  </head>
  <body>
    <script>window.clicked = "";</script>
    <table id="anchoDoc">
      <tbody>
        <tr onclick="window.clicked = 'row';">
          <td>0</td>
          <td onclick="event.stopPropagation(); window.clicked = 'cell';">1792049504001</td>
          <td>Proveedor</td>
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
      cellText: "1792049504001",
      match: "exact",
      targetSelectors: ["css=a[href]", "css=a", "css=button"]
    },
    5000
  );

  const clicked = await page.evaluate(() => window.clicked || "");
  assert.strictEqual(clicked, "cell");

  await browser.close();
  console.log("clickTableCellLink.selfcheck ok");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
