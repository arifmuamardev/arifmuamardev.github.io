"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const {inspect,muamalatBni,jpPostLinks,visaPayments,tokopediaSettlement}=
 require("../features/multi-account-reconciliation.js");
function fixture(){
 return {
 bni:[
 {id:5,date:"2026-09-07",sign:"+",amount:1000000,description:"BANK MUAMALAT - ACCOUNT HOLDER"},
 {id:6,date:"2026-10-18",sign:"-",amount:1774506,description:"TOKOPEDIA - PLSTOKOPEDIA"}
 ],
 muamalat:[{id:1,date:"2026-09-07",sign:"-",amount:1000000,
 type:"Transfer",description:"Transfer ke BNI rekening pemilik sama"}],
 jpPost:[
 {id:3,date:"2026-09-28",sign:"-",amount_jpy:35970,evidence_key:"JPPOST-RENT",
 type:"Life Card auto-debit"},
 {id:4,date:"2026-10-01",sign:"+",amount_jpy:372,evidence_key:"JPPOST-INTEREST",
 type:"Bank interest"}
 ],
 cardEvidence:[
 {kind:"bank_payment",payload:{on:"2026-09-10",payee:"Hokuriku VISA",
 amount_jpy:65842,verified_from_bank:true,direction:"out"}},
 {kind:"bank_payment",payload:{on:"2026-10-13",payee:"Hokuriku VISA",
 amount_jpy:5805,verified_from_bank:true,direction:"out"}}
 ],
 tokopediaStatements:[{statement_date:"2026-10-15",total_idr:1769506,
 payload:{payment_date:"2026-10-18",payment_fee_idr:5000,payment_bank_amount_idr:1774506}}],
 cash:[
 {id:40,tanggal:"2026-09-28",currency:"JPY",pengeluaran:35970,pemasukan:0,
 note:"SRC=JPPOST-RENT"},
 {id:41,tanggal:"2026-09-10",currency:"JPY",pengeluaran:65842,pemasukan:0,
 item:"Hokuriku VISA Card Payment",note:"Hokuriku VISA Auto-Debit (CC KU settlement)"},
 {id:42,tanggal:"2026-10-18",currency:"IDR",expense_idr:-1774506,
 pengeluaran:0,pemasukan:0,kategori:"Card Settlement",note:"Tokopedia Card payment",
 item:"Tokopedia Card statement payment"},
 {id:43,tanggal:"2026-10-18",currency:"IDR",expense_idr:5000,
 pengeluaran:45.62,pemasukan:0,note:"TKP-PAYMENT-FEE-20261018-5000",
 item:"Tokopedia Card payment processing fee"}
 ]
 };
}
const opts={asOf:"2026-10-20"};
test("source-labelled Muamalat transfer and same-date BNI credit are a pair, not income",()=>{
 const m=inspect(fixture(),opts);
 assert.equal(m.groups.interbank.paired,1);
 assert.equal(m.groups.interbank.total,1000000);
 assert.equal(m.groups.interbank.rows[0].creditId,"5");
});
test("same value different date or multiple BNI credits cannot be auto-paired",()=>{
 const f=fixture();f.bni[0].date="2026-09-08";
 assert.equal(inspect(f,opts).groups.interbank.paired,0);
 f.bni[0].date="2026-09-07";f.bni.push({...f.bni[0],id:56});
 assert.equal(inspect(f,opts).groups.interbank.paired,0);
 assert.equal(inspect(f,opts).groups.interbank.rows[0].status,"ambiguous");
});
test("external Muamalat recipient not classified internal even with same amount",()=>{
 const f=fixture();f.muamalat[0].description="Transfer ke Bank Mandiri recipient";
 assert.equal(inspect(f,opts).groups.interbank.paired,0);
});
test("Japan Post source marker, direction and exact native JPY amount required",()=>{
 const m=inspect(fixture(),opts);
 assert.equal(m.groups.jpPost.linked,1);
 assert.equal(m.groups.jpPost.sourceOnly,1);
 const f=fixture();f.cash[0].pengeluaran=35971;
 assert.equal(inspect(f,opts).groups.jpPost.linked,0);
});
test("verified Hokuriku VISA payment only linked to matching card settlement row",()=>{
 const m=inspect(fixture(),opts);
 assert.equal(m.groups.visa.rows.length,2);
 assert.equal(m.groups.visa.linked,1);
 assert.equal(m.groups.visa.sourceOnly,1);
 assert.equal(m.groups.visa.rows.find(x=>x.date==="2026-10-13").status,"source_only");
});
test("card settlement 1,774,506 split into 1,769,506 bill plus 5,000 fee",()=>{
 const m=inspect(fixture(),opts);
 assert.equal(m.groups.tokopedia.linked,1);
 assert.equal(m.groups.tokopedia.rows[0].ledgerId,"42");
 const f=fixture();f.cash=f.cash.filter(r=>r.id!==43);
 assert.equal(inspect(f,opts).groups.tokopedia.linked,0);
});
test("two fee records do not create a false verified card reconciliation",()=>{
 const f=fixture();f.cash.push({...f.cash[3],id:100});
 assert.equal(inspect(f,opts).groups.tokopedia.rows[0].status,"ambiguous");
});
test("future bank payments and future statements cannot be treated as posted",()=>{
 const f=fixture();
 f.cardEvidence.push({kind:"bank_payment",payload:{on:"2026-11-10",
 payee:"Hokuriku VISA",amount_jpy:42171,verified_from_bank:true,direction:"out"}});
 f.tokopediaStatements.push({statement_date:"2026-11-15",total_idr:1000,payload:{}});
 const m=inspect(f,opts);
 assert.equal(m.groups.visa.rows.length,2);
 assert.equal(m.groups.tokopedia.rows.length,1);
});
test("data never mutated and source errors reported as partial",()=>{
 const f=fixture();const before=JSON.stringify(f);f.cardEvidenceError=true;
 const m=inspect(f,opts);
 assert.equal(m.partial,true);
 assert.equal(m.sourceErrors[0],"cardEvidenceError");
 assert.equal(m.ready,true);
 assert.equal(JSON.stringify(f),before.replace('}',',"cardEvidenceError":true}'));
});
test("unknown data leaves no invented amounts",()=>{
 const m=inspect({},opts);
 assert.equal(m.ready,false);assert.equal(m.matched,0);
});
