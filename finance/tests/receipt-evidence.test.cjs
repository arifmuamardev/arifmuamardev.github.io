"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const {reconcileForTest}=require("../features/receipt-evidence.js");
const src=(key,status,linkedId,amt=506,cur="JPY",date="2026-10-15")=>({
 evidence_key:key,status,linked_ledger_id:linkedId,source_amount:amt,source_currency:cur,
 receipt_date:date,merchant:"FamilyMart",payload:{source_file:"a.png"}
});
const ledger=(id,key,amt,cur="JPY")=>({
 id,note:key,currency:cur,pengeluaran:cur==="JPY"?amt:amt/109.6,expense_idr:cur==="IDR"?amt:null
});
test("different days identical ¥506 remain independent",()=>{
 const input=[src("RCPT-D15","posted",1),src("RCPT-D16","posted",2,506,"JPY","2026-10-16")];
 const x=reconcileForTest(input,[ledger(1,"RCPT-D15",506),ledger(2,"RCPT-D16",506)]);
 assert.equal(x.posted,2);assert.equal(x.suspect,0);
});
test("same receipt source key repeated is flagged",()=>{
 const x=reconcileForTest([src("RCPT-X","posted",1),src("RCPT-X","posted",1)],
 [ledger(1,"RCPT-X",506)]);
 assert.equal(x.suspect,1);
});
test("posted source requires linked transaction with source key",()=>{
 const x=reconcileForTest([src("RCPT-X","posted",1)],[ledger(1,"Other Source",506)]);
 assert.equal(x.suspect,1);
});
test("missing posted ledger row flagged",()=>{
 const x=reconcileForTest([src("RCPT-X","posted",12)],[]);
 assert.equal(x.suspect,1);
});
test("IDR original amount compared to expense_idr, not normalized yen",()=>{
 const x=reconcileForTest([src("RCPT-X","posted",12,61000,"IDR")],
 [ledger(12,"RCPT-X",61000,"IDR")]);
 assert.equal(x.suspect,0);
});
test("posted amount mismatch is flagged without editing data",()=>{
 const r=ledger(1,"RCPT-X",505);
 const x=reconcileForTest([src("RCPT-X","posted",1)], [r]);
 assert.equal(x.suspect,1);assert.equal(r.pengeluaran,505);
});
test("duplicate receipt points to an existing ledger row without new expense",()=>{
 const x=reconcileForTest([src("RCPT-X","already_recorded",1969,13060)],[
  ledger(1969,"CC KU",13060)]);
 assert.equal(x.existing,1);assert.equal(x.posted,0);assert.equal(x.suspect,0);
});
test("pending screenshot must remain without ledger entry",()=>{
 const x=reconcileForTest([src("RCPT-X","pending",null,201000,"IDR")],[]);
 assert.equal(x.pending,1);assert.equal(x.suspect,0);
});
test("pending that wrongly links to a ledger entry is flagged",()=>{
 const x=reconcileForTest([src("RCPT-X","pending",1)], [ledger(1,"RCPT-X",506)]);
 assert.equal(x.suspect,1);
});
test("load failure is explicit, not a false empty history",()=>{
 const x=reconcileForTest([],[],true);assert.equal(x.available,false);
});

test("BNI October card payment evidence uses original signed repayment not an extra purchase",()=>{
 const receipt=src("BNI-SCREEN-20261018-TOKOPEDIA-1774506","posted",2063,1774506,"IDR","2026-10-18");
 const raw=ledger(2063,"BNI-SCREEN-20261018-TOKOPEDIA-1774506",-1774506,"IDR");
 raw.kategori_normalized="Card Settlement";
 const result=reconcileForTest([receipt],[raw]);
 assert.equal(result.posted,1);assert.equal(result.suspect,0);
});
test("old pending app screenshot is shown settled only when bank-backed splits appear in ledger",()=>{
 const original=src("RCPT-20261015-GOPAY-201000","pending",null,201000,"IDR");
 original.payload.details={bank_confirmation:{status:"posted_to_BNI",topup_amount_idr:200000,
 fee_idr:1000,topup_ledger_source:"BNI-SCREEN-20261015-GOPAY-200000",
 fee_ledger_source:"BNI-SCREEN-20261015-GOPAY-FEE-1000"}};
 const ledgers=[ledger(1,"BNI-SCREEN-20261015-GOPAY-200000",200000,"IDR"),
 ledger(2,"BNI-SCREEN-20261015-GOPAY-FEE-1000",1000,"IDR")];
 const result=reconcileForTest([original],ledgers);
 assert.equal(result.pending,1);assert.equal(result.items[0].laterConfirmed,true);
 assert.equal(result.suspect,0);
 assert.equal(reconcileForTest([original],[]).suspect,1);
});
