(() => {
"use strict";
const val=x=>Number(x)||0;
const str=x=>String(x??"");
const day=x=>str(x).slice(0,10);
const diff=(a,b)=>{
  const x=Date.parse(day(a)+"T00:00:00Z"),y=Date.parse(day(b)+"T00:00:00Z");
  return Number.isFinite(x)&&Number.isFinite(y)?Math.abs(x-y)/86400000:Infinity;
};
const idr=x=>"Rp"+new Intl.NumberFormat("id-ID").format(val(x));
const yen=x=>"¥"+new Intl.NumberFormat("ja-JP",{maximumFractionDigits:2}).format(val(x));
const display=k=>({bni:"BNI",muamalat:"Muamalat",gopay:"GoPay"}[k]||k);
function banks(data) {
  return ["bni","muamalat","gopay"].flatMap(account=>
    (Array.isArray(data?.[account])?data[account]:[]).map(r=>({
      account,id:Number(r.id),date:day(r.date),sign:str(r.sign).trim(),
      amount:val(r.amount),description:str(r.description),type:str(r.type)
    }))
  ).filter(x=>x.id>0&&x.date&&x.amount>=0);
}
function matchDebit(row,source){
  if(str(row.currency).toUpperCase()!=="IDR"||val(row.expense_idr)<=0)
    return {state:"no_native_source",matches:[],reason:"No original IDR debit / no Japanese statement"};
  const candidates=source.filter(s=>s.sign==="-"&&Math.abs(s.amount-val(row.expense_idr))<=1&&
    diff(s.date,row.tanggal)<=1).sort((a,b)=>diff(a.date,row.tanggal)-diff(b.date,row.tanggal)||
      a.account.localeCompare(b.account)||a.id-b.id);
  if(!candidates.length)return {state:"missing",matches:[],reason:"No source-account debit matched"};
  if(candidates.length>1)return {state:"ambiguous",matches:candidates.slice(0,4),reason:"Several possible same-value debits"};
  return {state:"source_candidate",matches:candidates,reason:"One dated, signed debit; purpose still unverified"};
}
function bankPairs(source){
  const debits=source.filter(x=>x.sign==="-"&&x.amount>0);
  const credits=source.filter(x=>x.sign==="+"&&x.amount>0);
  const choices=d=>credits.filter(c=>c.account!==d.account&&c.amount===d.amount&&c.date===d.date);
  const reverse=c=>debits.filter(d=>d.account!==c.account&&c.amount===d.amount&&c.date===d.date);
  const pairs=[],ambiguous=[];
  for(const d of debits){
    const cs=choices(d);
    if(!cs.length)continue;
    if(cs.length!==1||reverse(cs[0]).length!==1)ambiguous.push({debit:d,count:cs.length});
    else pairs.push({from:d,to:cs[0]});
  }
  pairs.sort((a,b)=>b.from.date.localeCompare(a.from.date)||a.from.id-b.from.id);
  return {pairs,ambiguous};
}
function cardGap(evidence,source,cash=[],statements=[]){
  const imported=(Array.isArray(evidence)?evidence:[])
    .find(x=>x.evidence_key==="tokopedia_transactions_20261014");
  const payment=imported?.payload?.lines?.find(x=>x.source_id==="TKP-SHOT-20260922-P01");
  if(!payment)return {state:"unknown"};
  const original=val(payment.amount_idr),paymentDate=day(payment.date);
  const possible=source.filter(x=>x.account==="bni"&&x.sign==="-"&&x.date===paymentDate&&
    /TOKOPEDIA/i.test(x.description)&&Math.abs(x.amount-original)<=10000);
  if(possible.length!==1)return {state:possible.length?"ambiguous":"missing",original,paymentDate};
  const bank=possible[0],gap=bank.amount-original;
  if(Math.abs(gap)<=1)return {state:"exact",original,paymentDate,bankDebit:bank.amount,gap};
  // Confirm the historical fee ONLY if the official later statement explicitly
  // references this previous repayment and both corresponding ledger entries.
  const proof=(Array.isArray(statements)?statements:[]).filter(x=>{
    const p=x.payload||{};
    return Number(p.previous_payment_idr)===original &&
      Number(p.previous_payment_fee_idr)===gap && gap>0 &&
      Number(p.previous_payment_bank_debit_idr)===bank.amount &&
      String(p.previous_payment_bni_id)===String(bank.id);
  });
  const ledger=Array.isArray(cash)?cash:[];
  const feeRows=ledger.filter(x=>day(x.tanggal)===paymentDate &&
    str(x.currency)==="IDR" && val(x.expense_idr)===gap &&
    val(x.pengeluaran)>0 &&
    /TKP-PAYMENT-FEE-20260922-5000/i.test(str(x.note)));
  const settlements=ledger.filter(x=>day(x.tanggal)===paymentDate &&
    str(x.currency)==="IDR" &&
    val(x.expense_idr)===-original && val(x.pengeluaran)===0 &&
    /Card Settlement/i.test(str(x.kategori_normalized||x.kategori)) &&
    /TKP-SHOT-20260922-P01/.test(str(x.note)));
  if(proof.length===1 && feeRows.length===1 && settlements.length===1 &&
    String(proof[0].payload.previous_payment_fee_ledger_id)===String(feeRows[0].id) &&
    String(proof[0].payload.previous_payment_ledger_id)===String(settlements[0].id))
    return {state:"explained_fee",original,paymentDate,bankDebit:bank.amount,gap,
      feeLedgerId:Number(feeRows[0].id)};
  return {state:"difference",original,paymentDate,bankDebit:bank.amount,gap};
}
function inspect(data={}){
  const classifier=typeof window!=="undefined"?window.FinanceFlowClassifier:
    typeof require!=="undefined"?require("./flow-classifier.js"):null;
  if(!classifier)return {ready:false,reason:"Shared classifier unavailable"};
  const native=banks(data),movements=(Array.isArray(data.cash)?data.cash:[])
    .filter(r=>{
      const x=classifier.classify(r);
      return x.kind==="unclassified"||(x.kind==="movement"&&x.confidence==="review");
    }).map(r=>({
      id:Number(r.id),date:day(r.tanggal),name:str(r.item||r.item_normalized),
      kind:classifier.classify(r).kind,currency:str(r.currency),amountYen:val(r.pengeluaran),
      originalIDR:val(r.expense_idr),match:matchDebit(r,native)
    })).sort((a,b)=>b.date.localeCompare(a.date)||b.id-a.id);
  const count=state=>movements.filter(x=>x.match.state===state).length;
  const pairs=bankPairs(native);
  return {ready:true,movements,pairs,card:cardGap(data.tokopediaEvidence,native,data.cash,data.tokopediaStatements),
    counts:{review:movements.length,source:count("source_candidate"),
      ambiguous:count("ambiguous"),notFound:count("missing")+count("no_native_source"),
      pairs:pairs.pairs.length,pairAmbiguous:pairs.ambiguous.length},
    ownershipVerified:false};
}
let data={cash:[],bni:[],muamalat:[],gopay:[],tokopediaEvidence:[]},filter="all";
const node=(tag,cls,content)=>{
  const n=document.createElement(tag);
  if(cls)n.className=cls;
  if(content!==undefined)n.textContent=str(content);
  return n;
};
const put=(id,v)=>{const n=document.getElementById(id);if(n)n.textContent=str(v);};
function showMovements(m){
 const el=document.getElementById("transfer-proof-rows");
 if(!el)return;
 el.replaceChildren();
 const selected=m.movements.filter(x=>filter==="all"||(filter==="matched"&&x.match.state==="source_candidate")||
   (filter==="review"&&x.match.state!=="source_candidate"));
 for(const item of selected){
   const btn=node("button","transfer-proof-row");btn.type="button";btn.dataset.transferLedger=String(item.id);
   const copy=node("span","transfer-proof-copy");copy.append(node("strong","",item.name));
   copy.append(node("small","",item.date+" · "+item.kind+" · "+item.match.reason));
   if(item.match.matches.length)copy.append(node("small","",
     item.match.matches.map(r=>display(r.account)+" "+r.date+" "+idr(r.amount)).join(" / ")));
   btn.append(copy,node("strong","transfer-proof-amount",
      item.currency==="IDR"&&item.originalIDR>0?idr(item.originalIDR)+" / "+yen(item.amountYen):yen(item.amountYen)));
   el.append(btn);
 }
 if(!selected.length)el.append(node("p","transfer-proof-muted","No transactions in this filter."));
 put("transfer-proof-shown",selected.length+" records shown");
}
function showPairs(m){
 const el=document.getElementById("transfer-proof-pairs-list");
 if(!el)return;
 el.replaceChildren();
 for(const {from,to} of m.pairs.pairs.slice(0,15)){
   const row=node("div","transfer-proof-row");
   const copy=node("span","transfer-proof-copy");
   copy.append(node("strong","",display(from.account)+" → "+display(to.account)));
   copy.append(node("small","",from.date+" · exact bank debit/credit counterpart"));
   copy.append(node("small","",from.description+" / "+to.description));
   row.append(copy,node("strong","transfer-proof-amount",idr(from.amount)));el.append(row);
 }
 if(!m.pairs.pairs.length)el.append(node("p","transfer-proof-muted","No unique same-day bank counterparts."));
 if(m.pairs.ambiguous.length)el.append(node("p","transfer-proof-muted",
   m.pairs.ambiguous.length+" ambiguous bank debits left unpaired."));
}
function render(){
 const m=inspect(data);
 const empty=document.getElementById("transfer-proof-unavailable");
 const content=document.getElementById("transfer-proof-content");
 if(!m.ready){if(empty){empty.textContent=m.reason;empty.classList.remove("hidden");}content?.classList.add("hidden");return;}
 empty?.classList.add("hidden");content?.classList.remove("hidden");
 put("transfer-proof-review",m.counts.review);put("transfer-proof-source",m.counts.source);
 put("transfer-proof-ambiguous",m.counts.ambiguous);put("transfer-proof-missing",m.counts.notFound);
 put("transfer-proof-paired",m.counts.pairs);put("transfer-proof-ownership","Unverified");
 const p=m.card;
 const msg=p.state==="explained_fee"
  ?"Tokopedia Card payment reconciled: "+idr(p.original)+" card settlement + "+idr(p.gap)+
    " verified processing fee = "+idr(p.bankDebit)+" BNI debit. Fee exists separately in the ledger (#"+p.feeLedgerId+"). Repayment is not another purchase."
  :p.state==="difference"
  ?"Tokopedia Card payment: "+idr(p.original)+" shown on card, but BNI debit is "+idr(p.bankDebit)+
    " ("+idr(p.gap)+" difference). No complete source-linked fee explanation; review before changing records."
  :p.state==="exact"?"Tokopedia payment matches BNI debit amount.":
    "Tokopedia Card payment cannot be reconciled uniquely with the supplied source data.";
 put("transfer-proof-payment",msg);
 showMovements(m);showPairs(m);
}
function setData(next={}){
 data={cash:Array.isArray(next.cash)?next.cash:[],
 bni:Array.isArray(next.bni)?next.bni:[],
 muamalat:Array.isArray(next.muamalat)?next.muamalat:[],
 gopay:Array.isArray(next.gopay)?next.gopay:[],
 tokopediaEvidence:Array.isArray(next.tokopediaEvidence)?next.tokopediaEvidence:[],
 tokopediaStatements:Array.isArray(next.tokopediaStatements)?next.tokopediaStatements:[]};render();
}
function init(){
 const root=document.getElementById("view-transfer-proof");
 root?.addEventListener("click",event=>{
   const entry=event.target.closest("[data-transfer-ledger]");
   if(entry){const id=Number(entry.dataset.transferLedger);if(Number.isFinite(id))
     window.dispatchEvent(new CustomEvent("budget:open-transaction",{detail:{id}}));return;}
   const button=event.target.closest("[data-transfer-filter]");
   if(button){filter=button.dataset.transferFilter;
     root.querySelectorAll("[data-transfer-filter]").forEach(x=>x.classList.toggle("active",x===button));
     render();}
 });
 render();
}
if(typeof window!=="undefined")window.FinanceTransferProof={init,setData,render};
if(typeof module!=="undefined"&&module.exports)module.exports={inspectForTest:inspect,matchDebitForTest:matchDebit,
 bankPairsForTest:bankPairs,cardGapForTest:cardGap};
})();