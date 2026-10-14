"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {snapshotForTest} = require("../features/visa-review.js");
function evidence(key,kind,payload){return {evidence_key:key,kind,payload};}
const fixture=()=>[
 evidence("statement_2026-11-10","statement",{due_date:"2026-11-10",total_jpy:3000,
   lines:[{line_no:1,transaction_date:"2026-10-11",merchant:"Bus",amount_jpy:500},
     {line_no:2,transaction_date:"2026-10-11",merchant:"Bus",amount_jpy:500},
     {line_no:3,transaction_date:"2026-10-08",merchant:"Software",amount_jpy:2000}]}),
 evidence("statement_2026-10-13","statement",{due_date:"2026-10-13",total_jpy:1000,status:"paid_verified",
   lines:[{line_no:1,transaction_date:"2026-09-10",merchant:"Electric",amount_jpy:1000}]}),
 evidence("credit_snapshot_2026-10-14","credit_snapshot",{credit_limit_jpy:10000,outstanding_jpy:3200,available_jpy:6800,as_of:"2026-10-14"}),
 evidence("bank_payment_2026-10-13","bank_payment",{on:"2026-10-13",amount_jpy:1000,verified_from_bank:true}),
 evidence("bank_balance_2026-09-30","bank_balance",{balance_jpy:8000}),
 evidence("bank_balance_2026-10-14","bank_balance",{balance_jpy:7000}),
 evidence("bank_payment_2026-09-10","bank_payment",{amount_jpy:2500})
];
function tx(id,date,expense,note){return {id,tanggal:date,pengeluaran:expense,note};}
test("document and credit equations verified independently",()=>{
 const m=snapshotForTest(fixture(),[]);
 assert.ok(m.available);
 assert.ok(m.checks.novDocument&&m.checks.octoberDocument&&m.checks.creditLimit);
 assert.equal(m.counts.total,3);
 assert.equal(m.outstandingVsBill,200);
});
test("bank debit matches final October statement without adding expense",()=>{
 const m=snapshotForTest(fixture(),[]);
 assert.ok(m.checks.octoberPaid&&m.checks.bankBalanceMovement);
 assert.equal(m.octPayment.amount_jpy,1000);
});
test("identical date/amount purchase is consumed only once",()=>{
 const m=snapshotForTest(fixture(),[tx(1,"2026-10-11",500,"CC KU")]);
 assert.equal(m.counts.ccCandidates,1);
 assert.equal(m.counts.unmatched,2);
});
test("two separate posted transactions can match two same-value lines",()=>{
 const m=snapshotForTest(fixture(),[tx(1,"2026-10-11",500,"CC KU"),tx(2,"2026-10-11",500,"CC KU")]);
 assert.equal(m.counts.ccCandidates,2);
 assert.equal(m.counts.unmatched,1);
});
test("tagged CC KU candidate beats untagged date/amount",()=>{
 const m=snapshotForTest(fixture(),[tx(3,"2026-10-11",500,"Cash"),tx(4,"2026-10-11",500,"CC KU")]);
 assert.equal(m.lines[0].ledgerId,4);
 assert.equal(m.lines[1].status,"amount_candidate");
});
test("note with CC KU metadata is recognized, not only exact equality",()=>{
 const m=snapshotForTest(fixture(),[tx(9,"2026-10-08",2000,"CC KU (Amazon Order)")]);
 assert.equal(m.counts.ccCandidates,1);
});
test("non-card matching amount remains tentative, not confirmed",()=>{
 const m=snapshotForTest(fixture(),[tx(9,"2026-10-08",2000,"Cash purchase")]);
 assert.equal(m.counts.amountCandidates,1);
 assert.equal(m.counts.ccCandidates,0);
});
test("same amount on wrong date is not silently linked",()=>{
 const m=snapshotForTest(fixture(),[tx(9,"2026-10-07",2000,"CC KU")]);
 assert.equal(m.counts.unmatched,3);
});
test("document total mismatch is surfaced, not silently adjusted",()=>{
 const x=fixture();x[0].payload.total_jpy=3100;
 assert.equal(snapshotForTest(x,[]).checks.novDocument,false);
});
test("credit outstanding and provisional bill need not match",()=>{
 const m=snapshotForTest(fixture(),[]);
 assert.ok(m.checks.creditLimit);
 assert.equal(m.outstandingVsBill,200);
});
test("missing evidence is unavailable and not zero",()=>{
 const m=snapshotForTest([],[]);
 assert.equal(m.available,false);
 assert.ok(m.reason);
});
test("load failure is explicit",()=>{
 const m=snapshotForTest(fixture(),[],true);
 assert.equal(m.available,false);
});
test("bank-balance discrepancy cannot pass the check",()=>{
 const x=fixture();x[5].payload.balance_jpy=7200;
 assert.equal(snapshotForTest(x,[]).checks.bankBalanceMovement,false);
});
test("no identical ledger row may satisfy October and November sources twice",()=>{
 const x=fixture();
 x[0].payload.lines=[{line_no:1,transaction_date:"2026-09-10",merchant:"Electric",amount_jpy:1000}];
 x[0].payload.total_jpy=1000;
 const m=snapshotForTest(x,[tx(1,"2026-09-10",1000,"CC KU")]);
 assert.equal(m.counts.ccCandidates,1);
 assert.equal(m.octLines[0].status,"unmatched");
});
