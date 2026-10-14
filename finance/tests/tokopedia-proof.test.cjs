"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {snapshotForTest}=require("../features/tokopedia-proof.js");
function evidence(lines=[
 {source_id:"TKP-SHOT-20261009-01",date:"2026-10-09",merchant:"SHOPEE AIRPAY : 2/12",amount_idr:632167,status:"posted",normalized_item:"Shop installment",confidence:"high"},
 {source_id:"TKP-SHOT-20260928-01",date:"2026-09-28",merchant:"Traveloka3DS",amount_idr:90642,status:"posted",normalized_item:"Travel booking",confidence:"medium"},
 {source_id:"TKP-SHOT-20261014-01",date:"2026-10-14",merchant:"Retail USA",amount_idr:61603,status:"pending",normalized_item:"Unconfirmed",confidence:"low"},
 {source_id:"TKP-SHOT-20260922-P01",date:"2026-09-22",merchant:"PAYMENT_KKCB",amount_idr:3350609,status:"payment",normalized_item:"Card repayment",confidence:"high"}]){
 return [
 {evidence_key:"tokopedia_limits_20261014",payload:{credit_limit_idr:15000000,used_idr:9986281,available_idr:5013719}},
 {evidence_key:"tokopedia_transactions_20261014",payload:{captured_at:"2026-10-14",lines}}
 ];
}
const row=(id,date,raw,note,item="Shop", expense=raw/109.6)=>({
 id,tanggal:date,currency:"IDR",payment_type:"cashless",expense_idr:raw,pengeluaran:expense,note,item,item_normalized:item,tempat:item
});
test("bank card limit math is independent of ledger spending",()=>{
 const m=snapshotForTest(evidence(),[]);
 assert.equal(m.checks.limitEquation,true);
 assert.equal(m.counts.posted,2);
 assert.equal(m.totals.posted,722809);
 assert.equal(m.counts.pending,1);
 assert.equal(m.totals.pending,61603);
});
test("source-linked rows are exact matches and cannot be matched twice",()=>{
 const m=snapshotForTest(evidence(),[
  row(1,"2026-10-09",632167,"Tokopedia Card (Stmt: 2026-10-15) | TKP-SHOT-20261009-01"),
  row(2,"2026-09-28",90642,"Tokopedia Card | TKP-SHOT-20260928-01")
 ]);
 assert.equal(m.counts.imported,2);
 assert.equal(m.counts.missing,0);
 assert.equal(m.checks.noDoubleCount,true);
});
test("overlapping screenshot source IDs are deduplicated",()=>{
 const lines=evidence()[1].payload.lines;
 const m=snapshotForTest(evidence([...lines,lines[1]]),[]);
 assert.equal(m.lines.length,4);
});
test("earlier installment with same amount is NOT a duplicate",()=>{
 const m=snapshotForTest(evidence(),[
  row(1,"2026-09-09",632167,"Tokopedia Card (Stmt: 2026-09-15)","SHOPEE AIRPAY : 1/12")
 ]);
 assert.equal(m.counts.missing,2);
});
test("merchant/date/amount allows one-day drift with same card source",()=>{
 const m=snapshotForTest(evidence(),[
  row(1,"2026-10-08",632167,"Tokopedia Card","SHOPEE AIRPAY : 2/12")
 ]);
 assert.equal(m.counts.candidates,1);
});
test("same amount but unrelated merchant does not match",()=>{
 const m=snapshotForTest(evidence(),[
  row(1,"2026-10-09",632167,"Tokopedia Card","Unrelated Grocery")
 ]);
 assert.equal(m.counts.missing,2);
});
test("non-Tokopedia card transactions cannot be linked",()=>{
 const m=snapshotForTest(evidence(),[
  row(1,"2026-10-09",632167,"CC KU","SHOPEE AIRPAY : 2/12")
 ]);
 assert.equal(m.counts.missing,2);
});
test("pending source is not treated as posted even if no ledger entry",()=>{
 const m=snapshotForTest(evidence(),[]);
 assert.equal(m.counts.missing,2);
 assert.equal(m.counts.pending,1);
});
test("settlement is separate from income and expense",()=>{
 const m=snapshotForTest(evidence(),[
  row(2,"2026-09-22",-3350609,"Tokopedia Card (Payment: Rp 3,350,609) | TKP-SHOT-20260922-P01","PAYMENT_KKCB_TKP",0)
 ]);
 assert.equal(m.counts.payment,1);
 assert.equal(m.totals.settled,3350609);
 assert.equal(m.lines.find(x=>x.status==="payment").ledgerId,2);
});
test("missing proof is unavailable, never replaced with zero limits",()=>{
 assert.equal(snapshotForTest([],[]).available,false);
});
test("loading errors are displayed independently of normal ledger",()=>{
 assert.equal(snapshotForTest(evidence(),[],true).available,false);
});
test("bad credit-limit arithmetic yields an explicit failed check",()=>{
 const x=evidence();x[0].payload.available_idr=0;
 assert.equal(snapshotForTest(x,[]).checks.limitEquation,false);
});
test("wrong currency IDR value is never matched via JPY amount",()=>{
 const m=snapshotForTest(evidence(),[
  {id:1,tanggal:"2026-10-09",currency:"JPY",payment_type:"cashless",expense_idr:632167,
    note:"Tokopedia Card | TKP-SHOT-20261009-01",item:"SHOPEE AIRPAY"}
 ]);
 assert.equal(m.counts.imported,0);
});
test("unique ledger candidate is consumed at most once",()=>{
 const x=evidence();
 const src=x[1].payload.lines[0];
 x[1].payload.lines.push({...src,source_id:"TKP-SHOT-20261009-02"});
 const m=snapshotForTest(x,[row(1,"2026-10-09",632167,"Tokopedia Card","SHOPEE AIRPAY")]);
 assert.equal(m.counts.candidates,1);
 assert.equal(m.counts.missing,2);
});
