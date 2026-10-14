"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const {inspectForTest,matchDebitForTest,bankPairsForTest,cardGapForTest}=require("../features/transfer-proof.js");
const B=(account,id,sign,amount,date="2026-09-07",description="TRANSFER")=>
 ({account,id,sign,amount,date,description,type:"Transfer"});
const T=(amount,date="2026-09-07")=>({id:123,tanggal:date,currency:"IDR",expense_idr:amount,
 pengeluaran:amount/109.6,pemasukan:0,kategori_normalized:"Transfers & Movements",
 item:"Transfer to recipient",item_normalized:"Transfer to recipient"});
test("uniquely signed original-IDR debit is only a candidate",()=>{
 const m=matchDebitForTest(T(350000),[B("muamalat",1,"-",350000)]);
 assert.equal(m.state,"source_candidate");assert.equal(m.matches[0].account,"muamalat");
});
test("incoming sign cannot match outgoing transfer",()=>{
 assert.equal(matchDebitForTest(T(350000),[B("muamalat",1,"+",350000)]).state,"missing");
});
test("identical amount twice stays ambiguous",()=>{
 assert.equal(matchDebitForTest(T(350000),[B("muamalat",1,"-",350000),B("bni",1,"-",350000)]).state,"ambiguous");
});
test("one-day difference allowed, two-day difference rejected",()=>{
 assert.equal(matchDebitForTest(T(350000),[B("bni",1,"-",350000,"2026-09-08")]).state,"source_candidate");
 assert.equal(matchDebitForTest(T(350000),[B("bni",1,"-",350000,"2026-09-09")]).state,"missing");
});
test("do not compare original JPY movements with IDR accounts",()=>{
 assert.equal(matchDebitForTest({...T(350000),currency:"JPY",expense_idr:null},[B("bni",1,"-",350000)]).state,"no_native_source");
});
test("same-day unique opposite bank signs produce tentative counterpart",()=>{
 assert.equal(bankPairsForTest([B("muamalat",1,"-",1000000),B("bni",1,"+",1000000)]).pairs.length,1);
});
test("same account reversal is not an inter-account pair",()=>{
 assert.equal(bankPairsForTest([B("bni",1,"-",1000000),B("bni",2,"+",1000000)]).pairs.length,0);
});
test("duplicate credits block candidate bank pairing",()=>{
 const x=bankPairsForTest([B("muamalat",1,"-",1000000),B("bni",2,"+",1000000),B("gopay",3,"+",1000000)]);
 assert.equal(x.pairs.length,0);assert.equal(x.ambiguous.length,1);
});
test("duplicate debits cannot consume a single credit",()=>{
 const x=bankPairsForTest([B("muamalat",1,"-",1000000),B("gopay",2,"-",1000000),B("bni",3,"+",1000000)]);
 assert.equal(x.pairs.length,0);assert.equal(x.ambiguous.length,2);
});
test("different day opposite entries are not joined",()=>{
 assert.equal(bankPairsForTest([B("muamalat",1,"-",1000000),B("bni",1,"+",1000000,"2026-09-08")]).pairs.length,0);
});
test("Tokopedia screenshot vs BNI detects unexplained 5000 IDR",()=>{
 const evidence=[{evidence_key:"tokopedia_transactions_20261014",payload:{lines:[
 {source_id:"TKP-SHOT-20260922-P01",date:"2026-09-22",amount_idr:3350609}]}}];
 const result=cardGapForTest(evidence,[B("bni",1,"-",3355609,"2026-09-22","TOKOPEDIA")]);
 assert.equal(result.state,"difference");assert.equal(result.gap,5000);
});
test("ambiguous Tokopedia debit is not silently confirmed",()=>{
 const evidence=[{evidence_key:"tokopedia_transactions_20261014",payload:{lines:[
 {source_id:"TKP-SHOT-20260922-P01",date:"2026-09-22",amount_idr:3350609}]}}];
 assert.equal(cardGapForTest(evidence,[B("bni",1,"-",3355609,"2026-09-22","TOKOPEDIA"),
 B("bni",2,"-",3350609,"2026-09-22","TOKOPEDIA")]).state,"ambiguous");
});
test("missing card payment evidence remains unknown",()=>{
 assert.equal(cardGapForTest([],[]).state,"unknown");
});
test("model cannot assert legal ownership from connected statement records",()=>{
 const m=inspectForTest({cash:[T(350000)],muamalat:[{id:1,date:"2026-09-07",sign:"-",amount:350000,description:"Transfer"}]});
 assert.equal(m.ready,true);assert.equal(m.counts.source,1);assert.equal(m.ownershipVerified,false);
});
test("unclassified non-IDR source appears in review not personal spending",()=>{
 const m=inspectForTest({cash:[{id:22,tanggal:"2026-09-07",item:"Unknown",currency:"JPY",pengeluaran:100,
 kategori_normalized:"Others"}]});
 assert.equal(m.counts.review,1);assert.equal(m.counts.notFound,1);
});
test("source comparison does not alter underlying ledger values",()=>{
 const x=T(250000),before=JSON.stringify(x);
 matchDebitForTest(x,[B("bni",1,"-",250000)]);
 assert.equal(JSON.stringify(x),before);
});
