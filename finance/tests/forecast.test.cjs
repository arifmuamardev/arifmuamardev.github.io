"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { snapshotForTest } = require("../features/forecast.js");

function tx(id, date, expense = 0, options = {}) {
  return {
    id,
    tanggal: date,
    item_normalized: options.item || "Groceries",
    kategori_normalized: options.category || "Food",
    pengeluaran: expense,
    pemasukan: options.income || 0,
    saldo: options.balance ?? null
  };
}

function fixture() {
  return [
    tx(1, "2026-07-10", 1000),
    tx(2, "2026-08-10", 3000),
    tx(3, "2026-09-10", 2000),
    tx(4, "2026-10-02", 200, { balance: 10000 }),
    tx(5, "2026-10-31", 100),
    tx(6, "2026-11-30", 50),
    tx(7, "2026-12-31", 30)
  ];
}

const forecast = (rows, asOf = "2026-10-14", budgetRows = []) =>
  snapshotForTest({ rows, asOf, budgetRows });

test("recorded balance, median, future windows and runway are consistent", () => {
  const m = forecast(fixture());
  assert.equal(m.balance.value, 10000);
  assert.equal(m.medianSpend, 2000);
  assert.equal(m.currentMonthSpend, 200);
  assert.equal(m.next30.length, 1);
  assert.equal(m.next90.length, 3);
  assert.equal(m.impact30.outflow, 100);
  assert.equal(m.knownBalance30, 9900);
  assert.equal(m.historicalScenarioBalance, 8200);
  assert.equal(m.runway, 5);
});

test("combined stress counts October scheduled spending once", () => {
  const m = forecast(fixture());
  assert.equal(m.currentMonthKnownOutflow, 100);
  assert.equal(m.additionalStressOutflow, 1700);
  assert.equal(m.combinedStressBalance, 8200);
});

test("next-month known expenses are included separately in the 30-day stress", () => {
  const m = forecast([...fixture(), tx(8, "2026-11-01", 75)]);
  assert.equal(m.impact30.outflow, 175);
  assert.equal(m.currentMonthKnownOutflow, 100);
  assert.equal(m.combinedStressBalance, 8125);
});

test("future income affects known cash flow but not conservative stress", () => {
  const m = forecast([...fixture(), tx(8, "2026-11-01", 0, { income: 500 })]);
  assert.equal(m.impact30.inflow, 500);
  assert.equal(m.knownBalance30, 10400);
  assert.equal(m.combinedStressBalance, 8200);
});

test("excluded transfer is not counted as an upcoming obligation", () => {
  const m = forecast([...fixture(), tx(8, "2026-10-20", 400, { item: "Self-Transfer (Internal)" })]);
  assert.equal(m.impact30.outflow, 100);
  assert.equal(m.combinedStressBalance, 8200);
});

test("missing month is unknown, not zero: historical scenarios and runway disabled", () => {
  const rows = fixture().filter(item => !item.tanggal.startsWith("2026-08"));
  const m = forecast(rows);
  assert.equal(m.monthsWithRecords, 2);
  assert.equal(m.medianSpend, null);
  assert.equal(m.historicalScenarioBalance, null);
  assert.equal(m.combinedStressBalance, null);
  assert.equal(m.runway, null);
  assert.equal(m.confidence, "Limited");
});

test("genuine zero-expense month with recorded income remains valid", () => {
  const rows = fixture().map(item => item.id === 2
    ? tx(2, "2026-08-10", 0, { income: 40 })
    : item);
  const m = forecast(rows);
  assert.equal(m.monthsWithRecords, 3);
  assert.equal(m.medianSpend, 1000);
  assert.equal(m.combinedStressBalance, 9200);
});

test("freshness drives confidence only when all months contain records", () => {
  assert.equal(forecast(fixture()).confidence, "Limited");
  const recent = fixture().map(item => item.id === 4
    ? tx(4, "2026-10-14", 200, { balance: 10000 })
    : item);
  assert.equal(forecast(recent).confidence, "Moderate");
  const cautious = fixture().map(item => item.id === 4
    ? tx(4, "2026-10-10", 200, { balance: 10000 })
    : item);
  assert.equal(forecast(cautious).confidence, "Cautious");
});

test("zero median protects runway from division by zero", () => {
  const rows = [
    tx(1, "2026-07-01", 0, { income: 10 }),
    tx(2, "2026-08-01", 0, { income: 10 }),
    tx(3, "2026-09-01", 0, { income: 10 }),
    tx(4, "2026-10-14", 0, { balance: 2000 })
  ];
  const m = forecast(rows);
  assert.equal(m.medianSpend, 0);
  assert.equal(m.runway, null);
  assert.equal(m.combinedStressBalance, 2000);
});

test("negative future expense is handled as known inflow, ignored in conservative stress", () => {
  const m = forecast([...fixture(), tx(8, "2026-10-20", -20)]);
  assert.equal(m.impact30.inflow, 20);
  assert.equal(m.impact30.outflow, 100);
  assert.equal(m.knownBalance30, 9920);
  assert.equal(m.combinedStressBalance, 8200);
});

test("year-boundary date arithmetic keeps scheduled cash flow inside 30 days", () => {
  const rows = [tx(1, "2026-10-01", 0, { balance: 500 }),
    tx(2, "2026-12-31", 30), tx(3, "2027-01-15", 20)];
  const m = forecast(rows, "2026-12-20");
  assert.equal(m.next30.length, 2);
  assert.equal(m.impact30.outflow, 50);
});

test("budget targets remain independent of forecast's read-only logic", () => {
  const m = forecast(fixture(), "2026-10-14", [
    { month_start: "2026-10-01", category: "Food", amount: 1000 }
  ]);
  assert.equal(m.budget.count, 1);
  assert.equal(m.budget.spent, 200);
  assert.equal(m.budget.remaining, 800);
});
