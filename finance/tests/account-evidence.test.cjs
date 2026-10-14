"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { snapshotForTest } = require("../features/account-evidence.js");

function bank(id, date, sign, amount, balance, extra = {}) {
  return { id, date, time:"", sign, amount, balance,
    balance_jpy: extra.balanceJpy ?? null, type: extra.type || "Transfer" };
}
function ledger(id, date, income, expense, balance, item = "Groceries", currency="JPY") {
  return { id, tanggal:date, pemasukan:income, pengeluaran:expense, saldo:balance,
    currency, item_normalized:item };
}
function atm(id, date, source, type, amount, fee=0) {
  return {id,tanggal:date,source,type,amount,fee};
}
const bankRows = () => [
  bank(1,"2026-09-01","+",1000,1000,{balanceJpy:9.2}),
  bank(2,"2026-09-02","-",200,800,{balanceJpy:7.3}),
  bank(3,"2026-09-03","-",100,700,{balanceJpy:6.4}),
  bank(4,"2026-09-04","-",100,450,{balanceJpy:4.1})
];
const snapshot = data => snapshotForTest({data,asOf:"2026-10-14"});
const acc = (model,name) => model.accounts.find(x=>x.name===name);

test("BNI detects native IDR checkpoint discontinuity, not a missing JPY balance",()=>{
 const x=acc(snapshot({bni:bankRows()}),"BNI");
 assert.equal(x.count,4);
 assert.equal(x.compared,3);
 assert.equal(x.differences,1);
 assert.equal(x.issues[0].gapIdr,-150);
 assert.equal(x.indicatedJpy,4.1);
});
test("complete and consistent Muamalat/GoPay statements pass",()=>{
 const x=snapshot({muamalat:bankRows().slice(0,3),gopay:bankRows().slice(0,3)});
 assert.equal(acc(x,"Muamalat").differences,0);
 assert.equal(acc(x,"GoPay").compared,2);
});
test("missing native balance breaks comparison chain, not a false discontinuity",()=>{
 const rows=bankRows();
 rows[1].balance=null;
 const x=acc(snapshot({bni:rows}),"BNI");
 assert.equal(x.missingBalances,1);
 assert.equal(x.compared,1);
 assert.equal(x.differences,1);
});
test("unknown transaction sign cannot be interpreted as money in or out",()=>{
 const rows=bankRows();
 rows[2].sign="?";
 const x=acc(snapshot({bni:rows}),"BNI");
 assert.equal(x.unknownSigns,1);
 assert.equal(x.compared,2);
 assert.equal(x.differences,1);
});
test("reversed input rows sort by date and id deterministically",()=>{
 const x=acc(snapshot({bni:bankRows().reverse()}),"BNI");
 assert.equal(x.differences,1);
 assert.equal(x.balanceIdr,450);
});
test("future-dated bank statement is not an observed current balance",()=>{
 const rows=[...bankRows(),bank(5,"2026-12-01","+",5000,5450)];
 const x=acc(snapshot({bni:rows}),"BNI");
 assert.equal(x.count,4);
 assert.equal(x.balanceIdr,450);
});
test("stale balance does not become a present-day estimate",()=>{
 const x=acc(snapshot({bni:bankRows()}),"BNI");
 assert.equal(x.latestDate,"2026-09-04");
 assert.equal(x.ageDays,40);
});
test("JPY ledger checkpoint is not summed with IDR account snapshots",()=>{
 const x=snapshot({cash:[ledger(1,"2026-10-02",0,0,10000)],
  bni:bankRows()});
 assert.equal(x.ledger.balance,10000);
 assert.equal(acc(x,"BNI").balanceIdr,450);
 assert.equal(x.ledger.posted,1);
 assert.ok(!Object.hasOwn(x,"totalPortfolio"));
});
test("cash checkpoint not available does not become zero",()=>{
 const x=snapshot({cash:[ledger(1,"2026-10-02",0,100,null)]});
 assert.equal(x.ledger.balance,null);
});
test("transfer markers are observations and exclude regular spending and IDR",()=>{
 const x=snapshot({cash:[
  ledger(1,"2026-10-01",0,100,900,"Groceries"),
  ledger(2,"2026-10-02",500,0,1400,"Self-Transfer (Internal)"),
  ledger(3,"2026-10-03",0,20,null,"Remittance to Indonesia","IDR")
 ]});
 assert.equal(x.ledger.movements.length,1);
 assert.equal(x.ledger.movements[0].change,500);
});
test("ATM withdraw/deposit and fees stay distinct, not treated as expenses",()=>{
 const x=snapshot({withdrawals:[
  atm(1,"2026-09-01","Card ATM","withdrawal",5000,110),
  atm(2,"2026-09-02","Hokkoku Bank","deposit",4000,0)
 ]});
 assert.equal(x.atm.count,2);
 assert.equal(x.atm.withdrawals,5000);
 assert.equal(x.atm.deposits,4000);
 assert.equal(x.atm.fees,110);
 assert.equal(x.atm.sources.length,2);
});
test("future ATM events excluded and no speculative account mapping",()=>{
 const x=snapshot({withdrawals:[atm(1,"2026-12-01","Card ATM","withdrawal",10000)]});
 assert.equal(x.atm.count,0);
 assert.equal(x.manualAccounts.length,3);
 assert.ok(x.manualAccounts.includes("Japan Post Bank"));
});
test("invalid input dates are not posted observations",()=>{
 const x=snapshot({bni:[bank(1,"2026-02-30","+",10,10)],
  cash:[ledger(1,"2026-02-30",0,0,100)]});
 assert.equal(acc(x,"BNI").count,0);
 assert.equal(x.ledger.posted,0);
});
test("native balance comparisons tolerate one rupiah of rounding",()=>{
 const x=acc(snapshot({bni:[bank(1,"2026-10-01","+",100,100),
  bank(2,"2026-10-02","+",100,200.5)]}),"BNI");
 assert.equal(x.compared,1);
 assert.equal(x.differences,0);
});
