"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {reconcile}=require("../features/gopay-reconciliation.js");
function fixture(){
 const rows=[{date:"2026-09-03",type:"Top Up",method:"jago",sign:"+",amount:700,transaction_id:"a"},
 {date:"2026-09-04",type:"Top Up",method:"jago",sign:"+",amount:900,transaction_id:"b"},
 {date:"2026-09-05",type:"Pembayaran",method:"card",sign:"-",amount:310,transaction_id:"c"}];
 return {
 receipts:[{evidence_key:"GOPAY-ESTATEMENT-202609",payload:{source_rows:rows,coins_used:23}}],
 gopay:[{id:1,date:"2026-09-03",type:"Top Up",sign:"+",amount:700},
 {id:2,date:"2026-09-04",type:"Top Up",sign:"+",amount:900},
 {id:3,date:"2026-09-05",sign:"-",amount:310,payment_method:"Credit Card"},
 {id:4,date:"2026-09-07",sign:"-",amount:0,coins:120}],
 bni:[{id:5,date:"2026-09-03",sign:"-",amount:700,description:"TOP UP GOPAY"},
 {id:6,date:"2026-09-04",sign:"-",amount:900,description:"TOP UP GOPAY"},
 {id:7,date:"2026-09-03",sign:"-",amount:1000,description:"EWALLET TOP UP GOPAY"},
 {id:8,date:"2026-09-04",sign:"-",amount:1000,description:"EWALLET TOP UP GOPAY"}],
 cash:[{id:9,tanggal:"2026-09-03",currency:"IDR",expense_idr:1000,pengeluaran:9,item:"Biaya Top Up GoPay"},
 {id:10,tanggal:"2026-09-04",currency:"IDR",expense_idr:1000,pengeluaran:9,item:"Biaya Top Up GoPay"},
 {id:11,tanggal:"2026-09-05",currency:"IDR",expense_idr:310,pengeluaran:3,item:"Bill",note:"Tokopedia Card"}]
 };
}
test("unique BNI and GoPay movement pairs are separated from genuine fees",()=>{
 const m=reconcile(fixture());
 assert.equal(m.matched,2);assert.equal(m.total,1600);
 assert.equal(m.feesMatched,2);assert.equal(m.feeTotal,2000);
});
test("card purchase is source-linked only once; legacy coin delta remains exception",()=>{
 const m=reconcile(fixture());
 assert.equal(m.cardMatched,1);assert.equal(m.cardTotal,310);
 assert.equal(m.coinsExceptions[0].coins,120);
 assert.equal(m.coinsReportedUsed,23);
});
test("multiple bank debit candidates are ambiguous, not auto-paired",()=>{
 const x=fixture();x.bni.push({...x.bni[0],id:20});
 const m=reconcile(x);assert.equal(m.ambiguous,1);assert.equal(m.matched,1);
});
test("missing fee ledger or unverified statement never produces false matches",()=>{
 const x=fixture();x.cash=x.cash.filter(r=>r.id!==9);
 assert.equal(reconcile(x).feesMatched,1);
 assert.equal(reconcile({}).ready,false);
});
