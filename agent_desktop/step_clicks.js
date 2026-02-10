function requireValue(value, label) {
  if (!value) {
    throw new Error(`Missing ${label}`);
  }
}

function normText(value) {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value).replace(/\s+/g, " ").trim().toLowerCase();
}

function clipLog(value, max = 200) {
  if (!value) {
    return "";
  }
  const text = String(value);
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}...`;
}

async function findRowByText(tableLocator, rowText, timeout, logPrefix) {
  const target = normText(rowText);
  if (!target) {
    throw new Error(`${logPrefix} rowText empty or invalid.`);
  }

  let rows = tableLocator.locator("tbody tr");
  let rowCount = await rows.count();
  if (rowCount === 0) {
    rows = tableLocator.locator("tr");
    rowCount = await rows.count();
  }

  console.log(`[${logPrefix}] rows found=${rowCount}`);

  const summaries = [];
  let matchedIndex = -1;

  for (let i = 0; i < rowCount; i += 1) {
    const row = rows.nth(i);
    let rawText = "";
    try {
      rawText = await row.innerText({ timeout });
    } catch (error) {
      rawText = "";
    }
    const normalized = normText(rawText);
    summaries.push(`#${i}:${clipLog(normalized)}`);
    if (matchedIndex === -1 && normalized.includes(target)) {
      matchedIndex = i;
    }
  }

  console.log(`[${logPrefix}] row texts: ${summaries.join(" | ")}`);

  if (matchedIndex === -1) {
    throw new Error(`${logPrefix} rowText not found: "${rowText}"`);
  }

  const matchedRow = rows.nth(matchedIndex);

  console.log(`[${logPrefix}] matched row index=${matchedIndex}`);

  return { row: matchedRow, rowIndex: matchedIndex, rowCount };
}

async function clickTableCellLink(page, step, timeout) {
  requireValue(step.table, "step.table");
  const hasRowText =
    step.rowText !== undefined && step.rowText !== null && String(step.rowText).trim() !== "";
  const hasCellText =
    step.cellText !== undefined && step.cellText !== null && String(step.cellText).trim() !== "";

  if (!hasRowText && !hasCellText) {
    throw new Error("clickTableCellLink requiere rowText o cellText.");
  }

  const matchMode = step.match ? String(step.match).trim().toLowerCase() : "includes";
  if (!["includes", "exact"].includes(matchMode)) {
    throw new Error(`clickTableCellLink match invalido: ${step.match}`);
  }

  const linkSelectors =
    Array.isArray(step.targetSelectors) && step.targetSelectors.length
      ? step.targetSelectors
      : Array.isArray(step.linkSelectors) && step.linkSelectors.length
        ? step.linkSelectors
        : ["a[href]", "a[onclick]", "button[onclick]", "a", "button"];

  const hasCellIndex = step.cellIndex !== undefined && step.cellIndex !== null;
  const cellIndex = hasCellIndex ? Number(step.cellIndex) : null;
  if (hasCellIndex && !Number.isInteger(cellIndex)) {
    throw new Error(`clickTableCellLink cellIndex invalido: ${step.cellIndex}`);
  }
  const logUrl = Boolean(step.logUrl);

  console.log(
    `[clickTableCellLink] table=${step.table} rowText="${
      hasRowText ? step.rowText : "n/a"
    }" cellIndex=${hasCellIndex ? cellIndex : "n/a"} cellText="${
      hasCellText ? step.cellText : "n/a"
    }" match=${matchMode} linkSelectors=${JSON.stringify(linkSelectors)}`
  );
  if (logUrl) {
    console.log(`[clickTableCellLink] url(before)=${page.url()}`);
  }

  const table = page.locator(step.table).first();
  await table.waitFor({ state: "attached", timeout });

  let rows = table.locator("tbody tr");
  let rowCount = await rows.count();
  if (rowCount === 0) {
    rows = table.locator("tr");
    rowCount = await rows.count();
  }
  console.log(`[clickTableCellLink] rows found=${rowCount}`);

  let matchedRow = null;
  let matchedRowIndex = -1;
  let matchedCell = null;

  if (hasCellText) {
    if (!hasCellIndex) {
      throw new Error("clickTableCellLink cellText requiere cellIndex.");
    }
    const target = normText(step.cellText);
    if (!target) {
      throw new Error("clickTableCellLink cellText empty or invalid.");
    }
    if (logUrl) {
      console.log(`[clickTableCellLink] cell target="${target}"`);
    }

    const summaries = [];
    for (let i = 0; i < rowCount; i += 1) {
      const row = rows.nth(i);
      const cells = row.locator("td,th");
      let cellCount = 0;
      try {
        cellCount = await cells.count();
      } catch (error) {
        cellCount = 0;
      }

      if (cellIndex < 0 || cellIndex >= cellCount) {
        summaries.push(`#${i}:<no cell ${cellIndex}>`);
        continue;
      }

      const cell = cells.nth(cellIndex);
      let rawText = "";
      try {
        rawText = await cell.innerText({ timeout });
      } catch (error) {
        rawText = "";
      }
      const normalized = normText(rawText);
      summaries.push(`#${i}:${clipLog(normalized)}`);

      const matched =
        matchMode === "exact" ? normalized === target : normalized.includes(target);
      if (matchedRowIndex === -1 && matched) {
        matchedRowIndex = i;
        matchedRow = row;
        matchedCell = cell;
      }
    }

    console.log(`[clickTableCellLink] cell texts: ${summaries.join(" | ")}`);

    if (matchedRowIndex === -1) {
      throw new Error(`clickTableCellLink cellText not found: "${step.cellText}"`);
    }

    console.log(`[clickTableCellLink] matched row index=${matchedRowIndex}`);
  } else {
    const result = await findRowByText(table, step.rowText, timeout, "clickTableCellLink");
    matchedRow = result.row;
    matchedRowIndex = result.rowIndex;
  }

  let scope = matchedRow;
  if (matchedCell) {
    scope = matchedCell;
  } else if (hasCellIndex) {
    const cells = matchedRow.locator("td,th");
    const cellCount = await cells.count();
    console.log(`[clickTableCellLink] cellCount=${cellCount}`);
    if (cellIndex < 0 || cellIndex >= cellCount) {
      throw new Error(
        `clickTableCellLink: cellIndex ${cellIndex} fuera de rango (0-${Math.max(
          0,
          cellCount - 1
        )})`
      );
    }
    scope = cells.nth(cellIndex);
  }

  for (const selector of linkSelectors) {
    const candidates = scope.locator(selector);
    const count = await candidates.count();
    console.log(`[clickTableCellLink] scanning selector=${selector} count=${count}`);
    for (let i = 0; i < count; i += 1) {
      const candidate = candidates.nth(i);
      let visible = false;
      let enabled = true;
      try {
        visible = await candidate.isVisible();
      } catch (error) {
        visible = false;
      }
      try {
        enabled = await candidate.isEnabled();
      } catch (error) {
        enabled = true;
      }
      console.log(
        `[clickTableCellLink] candidate selector=${selector} index=${i} visible=${visible} enabled=${enabled}`
      );
      if (!visible || !enabled) {
        continue;
      }

      try {
        await candidate.scrollIntoViewIfNeeded({ timeout });
      } catch (error) {
        const detail =
          error && (error.name || error.message)
            ? error.name || error.message
            : String(error);
        console.log(`[clickTableCellLink] scroll failed: ${selector} - ${detail}`);
      }

      try {
        await candidate.click({ timeout, force: true });
        console.log(
          `[clickTableCellLink] clicked selector=${selector} index=${i}`
        );
        if (logUrl) {
          console.log(`[clickTableCellLink] url(after)=${page.url()}`);
        }
        return;
      } catch (error) {
        const detail =
          error && (error.name || error.message)
            ? error.name || error.message
            : String(error);
        console.log(`[clickTableCellLink] click failed: ${selector} - ${detail}`);
      }

      try {
        await candidate.evaluate((el) => el.click());
        console.log(
          `[clickTableCellLink] clicked via evaluate selector=${selector} index=${i}`
        );
        if (logUrl) {
          console.log(`[clickTableCellLink] url(after)=${page.url()}`);
        }
        return;
      } catch (error) {
        const detail =
          error && (error.name || error.message)
            ? error.name || error.message
            : String(error);
        console.log(`[clickTableCellLink] evaluate failed: ${selector} - ${detail}`);
      }
    }
  }

  if (matchedCell) {
    console.log(
      "[clickTableCellLink] no clickable link/button found. Falling back to cell/row click."
    );
    const fallbackTargets = [
      { label: "cell", locator: matchedCell },
      { label: "row", locator: matchedRow }
    ];

    for (const target of fallbackTargets) {
      let visible = false;
      let enabled = true;
      try {
        visible = await target.locator.isVisible();
      } catch (error) {
        visible = false;
      }
      try {
        enabled = await target.locator.isEnabled();
      } catch (error) {
        enabled = true;
      }
      console.log(
        `[clickTableCellLink] fallback ${target.label} visible=${visible} enabled=${enabled}`
      );

      try {
        await target.locator.scrollIntoViewIfNeeded({ timeout });
      } catch (error) {
        const detail =
          error && (error.name || error.message)
            ? error.name || error.message
            : String(error);
        console.log(
          `[clickTableCellLink] fallback scroll failed (${target.label}): ${detail}`
        );
      }

      try {
        await target.locator.click({ timeout, force: true });
        console.log(`[clickTableCellLink] fallback clicked ${target.label}`);
        if (logUrl) {
          console.log(`[clickTableCellLink] url(after)=${page.url()}`);
        }
        return;
      } catch (error) {
        const detail =
          error && (error.name || error.message)
            ? error.name || error.message
            : String(error);
        console.log(
          `[clickTableCellLink] fallback click failed (${target.label}): ${detail}`
        );
      }

      try {
        await target.locator.evaluate((el) => el.click());
        console.log(`[clickTableCellLink] fallback clicked via evaluate (${target.label})`);
        if (logUrl) {
          console.log(`[clickTableCellLink] url(after)=${page.url()}`);
        }
        return;
      } catch (error) {
        const detail =
          error && (error.name || error.message)
            ? error.name || error.message
            : String(error);
        console.log(
          `[clickTableCellLink] fallback evaluate failed (${target.label}): ${detail}`
        );
      }
    }
  }

  throw new Error(
    `clickTableCellLink: no se encontro link/button visible. selectors=${JSON.stringify(
      linkSelectors
    )}`
  );
}

module.exports = {
  clickTableCellLink
};
