"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const {classify,tally}=require("../features/flow-classifier.js");
function row(i,category,out=0,income=0,extra={}) {
 return {id:i,kategori_normalized:category,pengeluaran:out,pemasukan:income,
 tanggal:"2026-10-10",currency:"JPY",item_normalized:"Other",...extra};
}
test("all categories allocate gross raw totals once",()=>{
 const rows=[row(1,"Food & Dining",100),row(2,"Transfers & Movements",200),
 row(3,"Card Settlement",0),row(4,"Account Reconciliation",50,40),
 row(5,"Loans & Advances",15,20),row(6,"Others",35),
 row(7,"Scholarship Income",0,700)];
 const m=tally(rows);
 assert.equal(m.rawOut,400);assert.equal(m.rawIn,760);
 assert.equal(m.spending,100);assert.equal(m.movementOut,200);
 assert.equal(m.adjustmentOut,50);assert.equal(m.loanOut,15);
 assert.equal(m.unclassifiedOut,35);assert.equal(m.income,700);
 assert.equal(m.outflowGap,0);assert.equal(m.inflowGap,0);
});
test("bank inflow is movement not income",()=>{
 const m=tally([row(1,"Transfers & Movements",0,260000,{item_normalized:"Bank Inflow / Auto-Deposit"})]);
 assert.equal(m.income,0);assert.equal(m.movementIn,260000);
});
test("old Hokuriku VISA settlement is not spending",()=>{
 const r=row(1,"Transfers & Movements",65842,0,{
 item_normalized:"Self-Transfer (Internal)",item:"Hokuriku VISA Card Payment",
 note:"Hokuriku VISA Auto-Debit from Hokkoku Bank (CC KU settlement)"});
 assert.equal(classify(r).kind,"settlement");
});
test("card purchase tagged CC KU is ordinary spending",()=>{
 const r=row(1,"Software/Service",3000,0,{item:"ChatGPT",note:"CC KU"});
 assert.equal(classify(r).kind,"spending");
});
test("credit payment placeholder has no invented monetary movement",()=>{
 const m=tally([row(1,"Card Settlement",0,0,{expense_idr:-3350609})]);
 assert.equal(m.settlementOut,0);assert.equal(m.rawOut,0);
});
test("remittance outgoing excluded from consumption, but flagged uncertain",()=>{
 const m=tally([row(1,"Transfers & Movements",91257,0,{item_normalized:"Remittance to Indonesia"})]);
 assert.equal(m.spending,0);assert.equal(m.movementOut,91257);
 assert.equal(m.review.length,1);
});
test("named transfer to other person remains a review candidate",()=>{
 const m=tally([row(1,"Transfers & Movements",2000,0,{item:"Trf ke person",item_normalized:"Transfer to another"})]);
 assert.equal(m.review.length,1);
});
test("loan repaid is not external income",()=>{
 const m=tally([row(1,"Loans & Advances",0,76000,{item_normalized:"Loan Repayment (Ryan)"})]);
 assert.equal(m.income,0);assert.equal(m.loanIn,76000);
});
test("refund reduces net consumption rather than becoming income",()=>{
 const m=tally([row(1,"Elektronik",2000),row(2,"Discounts & Refunds",-250)]);
 assert.equal(m.spending,1750);assert.equal(m.income,0);
});
test("unclassified debit remains separate, not silently forced into consumption",()=>{
 const m=tally([row(1,"Others",14174.48)]);
 assert.equal(m.unclassifiedOut,14174.48);
 assert.equal(m.spending,0);
});
test("reconciliation credit isn't real income",()=>{
 const m=tally([row(1,"Account Reconciliation",0,67145.32)]);
 assert.equal(m.adjustmentIn,67145.32);assert.equal(m.income,0);
});
test("scheduled future entries excluded when asOf specified",()=>{
 const m=tally([row(1,"Food & Dining",100),{...row(2,"Food & Dining",100),tanggal:"2026-11-01"}],"2026-10-14");
 assert.equal(m.spending,100);
});
test("IDR-origin JPY normalization aggregates like other currency without new FX",()=>{
 const m=tally([row(1,"Research & Education",912.41,0,{currency:"IDR",expense_idr:100000})]);
 assert.equal(m.spending,912.41);
});
test("empty zero entries stay neutral",()=>{
 const m=tally([row(1,"Food & Dining",0)]);
 assert.equal(m.neutralRows,1);assert.equal(m.spending,0);
});
test("classification holds original amounts and ledger input unchanged",()=>{
 const a=row(1,"Transfers & Movements",300),copy=JSON.stringify(a);
 tally([a]);assert.equal(JSON.stringify(a),copy);
});

test("legacy Hokuriku VISA payment marker is settlement not ordinary transfer",()=>{
 const r=row(1,"Transfers & Movements",2152,0,
 {item:"Hokuriku VISA",item_normalized:"Self-Transfer (Internal)"});
 assert.equal(classify(r).kind,"settlement");
});
