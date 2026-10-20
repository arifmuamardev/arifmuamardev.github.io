"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {evaluate}=require("../features/gopay-proof.js");
function fixture(){
 const source=[
 {date:"2026-09-02",time:"10:30",method:"jago",sign:"+",amount:750037,coins:0,transaction_id:"a",type:"Top Up"},
 {date:"2026-09-05",time:"20:44",method:"card",sign:"-",amount:33171,coins:0,transaction_id:"b",type:"Pembayaran"},
 {date:"2026-09-10",time:"10:32",method:"jago",sign:"-",amount:150000,coins:0,transaction_id:"c",type:"Transfer"},
 {date:"2026-09-17",time:"00:32",method:"coins",sign:"+",amount:0,coins:47302,transaction_id:"d",type:"Cashback"},
 {date:"2026-09-19",time:"01:30",method:"jago",sign:"-",amount:647393,coins:0,transaction_id:"e",type:"Pembayaran"}
 ];
 // Synthetic numbers exercise matching separately from the official
 // 35-row summation gate (which requires the complete source file).
 const receipts=[
 {evidence_key:"GOPAY-ESTATEMENT-202609",payload:{source_rows:source,statement_expenditure_idr:783262,coins_used:47302}},
 {evidence_key:"GOPAY-HOME-20261020",receipt_date:"2026-10-20",source_type:"gopay_balance_snapshot",
 payload:{wallet_balance_idr:171489,coins_balance:156,october_spending_display_idr:33800}}
 ];
 const gopay=source.map((x,i)=>({id:i+1,date:x.date,payment_method:x.method==="card"?"Credit and Debit Card":x.method==="coins"?"GoPay Coins":"Tabungan by Jago",sign:x.sign,amount:x.amount,coins:x.coins}));
 return {receipts,gopay,source};
}
test("GoPay balance is taken only from verified screenshot, not inferred from partial statement",()=>{
 const x=evaluate(fixture());
 assert.equal(x.balance,171489);assert.equal(x.coins,156);
 assert.equal(x.snapshotDate,"2026-10-20");
});
test("October spending display is not inferred as a card bill",()=>{
 const x=evaluate(fixture());assert.equal(x.octoberSpending,33800);
 assert.equal(Object.hasOwn(x,"gopayLaterDebt"),false);
});
test("credit-card payment remains distinct from Jago wallet movement",()=>{
 const x=evaluate(fixture());assert.equal(x.cardExpense,33171);
 assert.equal(x.transferOut,150000);
});
test("all synthetic rows are matched only by signed amount and method",()=>{
 const x=evaluate(fixture());assert.equal(x.matched,5);assert.equal(x.missing,0);
});
test("card transaction cannot be matched to wallet-debit provenance",()=>{
 const x=fixture();x.gopay.find(v=>v.amount===33171).payment_method="Tabungan by Jago";
 assert.equal(evaluate(x).missing,1);
});
test("wrong coin quantity cannot silently match a cashback event",()=>{
 const x=fixture();x.gopay.find(v=>v.coins).coins=300;
 assert.equal(evaluate(x).missing,1);
});
test("duplicated candidate transactions are ambiguous, not matched twice",()=>{
 const x=fixture();x.gopay.push({...x.gopay[0],id:9});
 assert.equal(evaluate(x).ambiguous,1);
});
test("no snapshot means balance is unavailable, not zero",()=>{
 const x=fixture();x.receipts=x.receipts.slice(0,1);
 const m=evaluate(x);assert.equal(m.balance,null);assert.equal(m.hasSnapshot,false);
});
test("untrusted snapshot date is not treated as verified",()=>{
 const x=fixture();x.receipts[1].receipt_date="2026-10-01";
 assert.equal(evaluate(x).balance,null);
});
test("empty evidence does not invent September or October data",()=>{
 const x=evaluate({});assert.equal(x.statementFound,false);assert.equal(x.hasSnapshot,false);
});
test("source duplicates are flagged",()=>{
 const x=fixture();x.source.push({...x.source[0]});
 assert.equal(evaluate(x).duplicateIds,1);
});
test("load error is made available to UI instead of hiding",()=>{
 assert.equal(evaluate({loadError:true}).loadError,true);
});
