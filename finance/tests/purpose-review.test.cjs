"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {inspect,matchingSource,guidance}=require("../features/purpose-review.js");
const row=(id,date,item,category,jpy,other={})=>({
 id,tanggal:date,item,item_normalized:item,kategori_normalized:category,
 pengeluaran:jpy,pemasukan:0,currency:"JPY",expense_idr:null,...other
});
function fixture(){
 return {
  cash:[
   row(1,"2026-06-29","Bank Transfer / Payment","Others",28753),
   row(2,"2025-02-05","PAYPAL *INSTITUTEEL","Others",14174.48,
    {currency:"IDR",expense_idr:1553523}),
   row(3,"2026-05-26","Droppy","Others",1153),
   row(4,"2025-01-23","PAYPAL *SHENDUQRWEA","Others",805.87),
   row(5,"2025-09-24","Hutang Jeriko","Others",0),
   row(6,"2026-10-18","Transfer to Ika Maulita","Transfers & Movements",1824.82,
    {currency:"IDR",expense_idr:200000}),
   row(7,"2026-09-28","Transfer ke Ika Maulita","Transfers & Movements",27372.26,
    {currency:"IDR",expense_idr:3000000}),
   row(8,"2026-10-15","GoPay e-wallet top-up from BNI","Transfers & Movements",1824.82,
    {currency:"IDR",expense_idr:200000}),
   row(9,"2026-09-10","Hokuriku VISA Card Payment","Transfers & Movements",65842),
   row(10,"2026-10-19","Food","Food & Dining",100),
   row(11,"2026-12-01","Unknown future","Others",900)
  ],
  bni:[
   {id:100,date:"2026-10-18",sign:"-",amount:200000,description:"BNI - IKA"},
   {id:101,date:"2026-09-28",sign:"-",amount:3000000,description:"BNI - IKA"}
  ],
  muamalat:[
   {id:102,date:"2026-09-28",sign:"-",amount:3000000,description:"Transfer own account"}
  ]
 };
}
const asOf={asOf:"2026-10-20"};
test("one queue splits four unresolved monetary entries, one zero entry, and two recipient purposes",()=>{
 const m=inspect(fixture(),asOf);
 assert.equal(m.unknownPayments.length,4);
 assert.equal(m.unknownValueYen,44886.35);
 assert.equal(m.zeroRecords.length,1);
 assert.equal(m.recipientRows.length,2);
 assert.equal(m.pendingPurpose,6);
 assert.equal(m.recipientOriginalIDR,3200000);
 assert.equal(m.recipientSourceCandidate,1);
 assert.equal(m.recipientSourceAmbiguous,1);
});
test("same-day native-currency debit is a candidate only, never proof of spending",()=>{
 const x=fixture();
 const m=matchingSource(x.cash.find(r=>r.id===6),x.bni,x.muamalat);
 assert.equal(m.status,"single bank candidate");
 assert.equal(m.count,1);
 assert.deepEqual(m.accounts,["BNI"]);
 assert.match(guidance(x.cash[5],"recipient"),/Confirm purpose/);
});
test("multiple same-valued bank debits remain ambiguous",()=>{
 const m=inspect(fixture(),asOf);
 const x=m.recipientRows.find(x=>x.id===7);
 assert.equal(x.source.status,"ambiguous source candidates");
 assert.equal(x.source.count,2);
});
test("Jpy merchant classification cannot be decided by BNI numeric coincidence",()=>{
 const f=fixture();
 f.bni.push({id:201,date:"2026-06-29",sign:"-",amount:28753,description:"Other debit"});
 const m=inspect(f,asOf);
 assert.equal(m.unknownPayments.find(r=>r.id===1).source.status,"purpose unresolved");
});
test("bank-to-wallet topups and credit-card settlements are not named recipient queue rows",()=>{
 const m=inspect(fixture(),asOf);
 assert.deepEqual(m.recipientRows.map(x=>x.id).sort((a,b)=>a-b),[6,7]);
});
test("no source, no invented candidates, no future entries; no mutations",()=>{
 const f=fixture();const before=JSON.stringify(f);
 const m=inspect(f,asOf);
 assert.equal(m.all.some(r=>r.id===11),false);
 assert.equal(JSON.stringify(f),before);
 assert.equal(inspect({},asOf).ready,false);
});
