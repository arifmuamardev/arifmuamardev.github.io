"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const start = source.indexOf("function updateGoPayAccountView()");
const end = source.indexOf("function updateGoPayCharts(", start);
assert.ok(start !== -1 && end > start, "GoPay account view function exists");

function renderGoPayRow(balance) {
  const tbody = {
    innerHTML: "",
    rows: [],
    appendChild(node) { this.rows.push(node); }
  };
  const el = {
    "gopay-statement-select": { value: "September 2026" },
    "gopay-table-body": tbody,
    "gopay-transaction-count": { textContent: "" },
    "gopay-type-select": { value: "all" },
    "gopay-search-input": { value: "" }
  };
  const sandbox = {
    document: {
      getElementById(id) { return el[id] || null; },
      createElement() { return { innerHTML: "" }; }
    },
    gopayData: [{
      id: 999, year: 2026, month: "September", date: "2026-09-18",
      time: "14:47", type: "Pembayaran", description: "Test purchase",
      payment_method: "Tabungan by Jago", sign: "-",
      amount: 12000, amount_jpy: 110, coins: 0, coins_jpy: 0,
      balance
    }],
    getExchangeRate() { return 109.6; },
    formatCurrency(value) { return String(value); },
    escapeHtml(value) { return String(value); },
    updateGoPayCharts() {}
  };
  vm.runInNewContext(source.slice(start, end) + "\nupdateGoPayAccountView();", sandbox);
  assert.equal(tbody.rows.length, 1);
  const match = tbody.rows[0].innerHTML.match(/font-family: monospace; font-weight: 500;">\s*([^<]+?)\s*<\/td>/);
  assert.ok(match, "Balance column is present");
  return match[1].trim();
}

test("GoPay statement missing running balance is unavailable, not Rp0", () => {
  assert.equal(renderGoPayRow(null), "—");
  assert.equal(renderGoPayRow(undefined), "—");
  assert.equal(renderGoPayRow(""), "—");
});

test("GoPay statement genuine zero and nonzero checkpoints remain visible", () => {
  assert.equal(renderGoPayRow(0), "Rp 0");
  assert.equal(renderGoPayRow(171489), "Rp 171489");
});

test("GoPay chart labels gross debit movements rather than spending only", () => {
  const startChart = source.indexOf("function updateGoPayCharts(");
  assert.ok(startChart > 0);
  const chartSection = source.slice(startChart, startChart + 4700);
  assert.match(chartSection, /Gross debits \(incl\. transfers\/cards\)/);
});
