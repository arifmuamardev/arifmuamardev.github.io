"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { snapshotForTest } = require("../features/data-integrity.js");

function row(id, date, currency, income, expense, balance, opts = {}) {
  return {
    id, tanggal: date, currency, pemasukan: income, pengeluaran: expense,
    saldo: balance, expense_idr: opts.expenseIdr ?? null,
    item: opts.item || "Food", item_normalized: opts.item || "Food",
    kategori: "Household", kategori_normalized: "Household",
    tempat: "Sample", payment_type: "cash", note: opts.note || ""
  };
}
const sample = () => [
  row(1, "2026-10-01", "JPY", 1000, 0, 1000),
  row(2, "2026-10-02", "JPY", 0, 200, 800),
  row(3, "2026-10-03", "JPY", 0, 100, 700),
  row(4, "2026-10-04", "JPY", 0, 100, 450),
  row(5, "2026-10-02", "IDR", 0, 100, null, { expenseIdr: 10960 }),
  row(6, "2026-10-03", "IDR", 0, 200, null, { expenseIdr: 21920 }),
  row(7, "2026-10-04", "IDR", 0, 250, null, { expenseIdr: 27400 })
];
const check = (rows, asOf = "2026-10-14") => snapshotForTest({ rows, asOf });

test("one JPY balance gap is flagged, IDR-origin entries do not affect checkpoints", () => {
  const m = check(sample());
  assert.equal(m.balance.compared, 3);
  assert.equal(m.balance.mismatches, 1);
  assert.equal(m.balance.candidates[0].gap, -150);
  assert.equal(m.byCurrency.IDR, 3);
});
test("scheduled entries are not included in posted balance checks", () => {
  const m = check([...sample(), row(8,"2026-10-31","JPY",0,100,0)]);
  assert.equal(m.scheduled, 1);
  assert.equal(m.balance.compared, 3);
});
test("exact same contents with different IDs are only potential duplicates", () => {
  const arr = sample();
  arr.push({...arr[4],id:20});
  const m = check(arr);
  assert.equal(m.duplicate.extraRows,1);
  assert.equal(m.duplicate.groups,1);
  assert.equal(m.duplicate.candidates[0].ids.length,2);
});
test("different note or balance avoids false exact duplicate", () => {
  const arr = sample();
  arr.push({...arr[4],id:20,note:"Second purchase"});
  assert.equal(check(arr).duplicate.extraRows,0);
});
test("IDR conversion benchmark inferred from historic pairs", () => {
  const m=check(sample());
  assert.equal(m.fx.pairs,3);
  assert.ok(Math.abs(m.fx.benchmark-109.6)<1e-9);
  assert.equal(m.fx.exceptions,0);
});
test("material conversion deviation is flagged but not changed", () => {
  const arr=sample();
  arr.push(row(12,"2026-10-05","IDR",0,150,null,{expenseIdr:12000}));
  const m=check(arr);
  assert.equal(m.fx.exceptions,1);
  assert.equal(arr[7].expense_idr,12000);
});
test("rounding tolerance tolerates very small IDR outlays", () => {
  const arr=sample();
  arr.push(row(14,"2026-10-08","IDR",0,.01,null,{expenseIdr:1}));
  assert.equal(check(arr).fx.exceptions,0);
});
test("missing FX evidence is unknown instead of zero exceptions", () => {
  const m=check(sample().filter(x=>x.currency==="JPY"));
  assert.equal(m.fx.benchmark,null);
  assert.equal(m.fx.exceptions,0);
});
test("missing and invalid dates are separated, no false scheduled flags", () => {
  const m=check([...sample(),row(8,"2026-02-31","JPY",0,20,0)]);
  assert.equal(m.invalidDates,1);
  assert.equal(m.scheduled,0);
});
test("chronological sort respects date then id", () => {
  const rows=sample().filter(x=>x.currency==="JPY").reverse();
  assert.equal(check(rows).balance.candidates[0].gap,-150);
});
test("currency labels outside JPY or IDR are made visible", () => {
  const m=check([...sample(),row(9,"2026-10-05","EUR",0,20,null)]);
  assert.equal(m.byCurrency.other,1);
});
test("freshness is measured against supplied Tokyo as-of date", () => {
  const m=check(sample(),"2026-10-14");
  assert.equal(m.lastPosted,"2026-10-04");
  assert.equal(m.daysSince,10);
});
