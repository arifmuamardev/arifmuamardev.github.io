"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { statementForTest, selectRows } = require("../features/jp-post-account.js");

const bank = (key,date,sign,amount,balance,id,type="Transfer") => ({
 evidence_key:key,date,sign,amount_jpy:amount,balance_jpy:balance,id,
 type,description:type+" "+key
});
const sample = ()=>[
 bank("atm","2026-08-03","-",50000,137580,1,"ATM withdrawal"),
 bank("atmfee","2026-08-03","-",220,137360,2,"ATM fee"),
 bank("aug_income","2026-08-25","+",145000,282360,3,"Incoming transfer"),
 bank("aug_rent","2026-08-27","-",35970,246390,4,"Life Card auto-debit"),
 bank("JPPOST-20260928-LIFECARD-35970","2026-09-28","-",35970,210420,5,"Life Card auto-debit"),
 bank("interest","2026-10-01","+",372,210792,6,"Interest"),
 bank("oct_income","2026-10-16","+",145000,355792,7,"Incoming transfer"),
 bank("oct_transfer","2026-10-18","+",9000,364792,8,"Incoming transfer")
];
const check=(r,c=[])=>statementForTest(r,c,{asOf:"2026-10-19"});

test("8 verified Japan Post rows reconcile with 7 consecutive balances",()=>{
 const x=check(sample());
 assert.equal(x.count,8);assert.equal(x.compared,7);
 assert.equal(x.gaps.length,0);assert.equal(x.balance,364792);
 assert.equal(x.balanceDate,"2026-10-18");
 assert.equal(x.firstDate,"2026-08-03");
});
test("October rent is bank paid even when ledger link is missing",()=>{
 const x=check(sample());
 assert.equal(x.rent.bankPaid,true);assert.equal(x.rent.amount,35970);
 assert.equal(x.rent.ledgerLinked,false);
});
test("source-marked main ledger confirms rent without inventing another transaction",()=>{
 const cash=[{id:2070,tanggal:"2026-09-28",currency:"JPY",pengeluaran:35970,
 pemasukan:0,note:"SRC=JPPOST-20260928-LIFECARD-35970"}];
 const x=check(sample(),cash);
 assert.equal(x.rent.bankPaid,true);assert.equal(x.rent.ledgerLinked,true);
 assert.equal(x.rent.ledgerId,2070);
 assert.equal(x.linkedLedgerCount,1);
});
test("wrong date or amount cannot establish account-to-ledger link",()=>{
 const c={id:2070,tanggal:"2026-09-29",currency:"JPY",pengeluaran:35970,
 pemasukan:0,note:"SRC=JPPOST-20260928-LIFECARD-35970"};
 assert.equal(check(sample(),[c]).rent.ledgerLinked,false);
 c.tanggal="2026-09-28";c.pengeluaran=35969;
 assert.equal(check(sample(),[c]).rent.ledgerLinked,false);
});
test("duplicate bank screenshot source is never treated as a second debit",()=>{
 const x=check([...sample(),sample()[4]]);
 assert.equal(x.count,8);assert.equal(x.duplicates.length,1);
 assert.equal(x.gaps.length,0);assert.equal(x.balance,364792);
});
test("an altered running balance is flagged but never silently corrected",()=>{
 const s=sample();s[5].balance_jpy=210800;
 const x=check(s);
 assert.equal(x.gaps.length,2);
 assert.equal(x.balance,364792);
});
test("missing balances break rather than bridge continuity",()=>{
 const s=sample();s[2].balance_jpy=null;
 const x=check(s);
 assert.equal(x.missingBalances,1);assert.equal(x.compared,5);
});
test("future-dated and impossible calendar dates are not counted as posted",()=>{
 const x=check([...sample(),
  bank("future","2026-11-02","-",9000,355792,9),
  bank("impossible","2026-02-30","+",1,1,10)]);
 assert.equal(x.count,8);assert.equal(x.invalidOrFuture,2);
});
test("unknown transaction sign never creates false positive receipt",()=>{
 const s=sample();s[4].sign="?";
 const x=check(s);
 assert.equal(x.rent.bankPaid,false);assert.equal(x.invalidOrFuture,1);
});
test("empty source is unavailable, not zero yen",()=>{
 const x=check([]);
 assert.equal(x.available,false);assert.equal(x.balance,null);
 assert.equal(x.rent.bankPaid,false);
});
test("load error does not pretend balance exists",()=>{
 const x=statementForTest(sample(),[],{asOf:"2026-10-19",loadError:true});
 assert.equal(x.available,false);assert.equal(x.error,true);
 assert.equal(x.balance,null);
});
test("month, direction, rent and search filters use bank source rows",()=>{
 const s=check(sample()).rows;
 assert.equal(selectRows(s,"2026-10","all","").length,3);
 assert.equal(selectRows(s,"all","in","").length,4);
 assert.equal(selectRows(s,"all","rent","").length,2);
 assert.equal(selectRows(s,"2026-09","rent","").length,1);
 assert.equal(selectRows(s,"all","all","interest").length,1);
});
test("same date uses sequence IDs for accurate balance checkpoints",()=>{
 const s=sample().reverse();
 const x=check(s);
 assert.equal(x.gaps.length,0);assert.equal(x.compared,7);
});
test("identical same-day amount with distinct evidence key isn't automatically a duplicate",()=>{
 const x=check([bank("a","2026-10-10","-",100,900,1),
 bank("b","2026-10-10","-",100,800,2)]);
 assert.equal(x.duplicates.length,0);assert.equal(x.gaps.length,0);
});
test("records never become a combined wallet or Hokkoku balance",()=>{
 const x=check(sample(),[{id:1,tanggal:"2026-10-02",currency:"JPY",saldo:416346}]);
 assert.equal(x.balance,364792);
 assert.equal(Object.hasOwn(x,"totalPortfolio"),false);
});
