(() => {
  "use strict";
  // Read-only source reconciliation. No bank account feed is a household-spending ledger.
  const str = v => String(v ?? "").trim();
  const day = v => str(v).slice(0, 10);
  const num = v => Number(v);
  const validMoney = v => v !== null && v !== undefined && v !== "" &&
    Number.isFinite(num(v)) && num(v) > 0;
  const sameMoney = (a,b) => validMoney(a) && validMoney(b) && Math.abs(num(a)-num(b)) < 0.01;
  const currency = (v, c) => (c === "JPY" ? "¥" : "Rp") +
    new Intl.NumberFormat(c === "JPY" ? "ja-JP" : "id-ID", {maximumFractionDigits: 0}).format(Number(v) || 0);
  const jpyLedger = r => str(r.currency).toUpperCase() === "JPY";
  const idrLedger = r => str(r.currency).toUpperCase() === "IDR";
  const inRange = (v, a, b) => day(v) >= a && day(v) <= b;
  const validDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d) &&
    !Number.isNaN(Date.parse(d+"T00:00:00Z")) &&
    new Date(d+"T00:00:00Z").toISOString().slice(0,10) === d;
  function todayTokyo() {
    const parts=Object.fromEntries(new Intl.DateTimeFormat("en-CA",{
      timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"
    }).formatToParts(new Date()).filter(x=>x.type!=="literal").map(x=>[x.type,x.value]));
    return parts.year+"-"+parts.month+"-"+parts.day;
  }
  function unique(rows) { return rows.length === 1 ? rows[0] : null; }

  function muamalatBni(data, asOf) {
    const m=(data.muamalat||[]).filter(r=>r.sign==="-" && validMoney(r.amount) &&
      inRange(r.date,"2026-08-01",asOf) && /transfer/i.test(str(r.type)) &&
      (/(?:ke\s+009-.*\bSDR\b|transfer ke BNI rekening pemilik sama)/i.test(str(r.description))));
    const b=(data.bni||[]).filter(r=>r.sign==="+" && validMoney(r.amount) &&
      inRange(r.date,"2026-08-01",asOf) && /^BANK MUAMALAT\b/i.test(str(r.description)));
    const rows=[],used=new Set();
    for (const debit of m) {
      const debitDate=day(debit.date);
      const candidates=b.filter(credit=>day(credit.date)===debitDate &&
        sameMoney(credit.amount,debit.amount));
      const reciprocal=candidates.filter(credit=>m.filter(other=>
        day(other.date)===day(credit.date) && sameMoney(other.amount,credit.amount)).length===1);
      const candidate=unique(reciprocal);
      const match=!!candidate && !used.has(str(candidate.id)) &&
        candidates.length===1;
      if(match)used.add(str(candidate.id));
      rows.push({date:debitDate,amount:num(debit.amount),currency:"IDR",
        debitId:str(debit.id),creditId:match?str(candidate.id):null,
        status:match?"paired":candidates.length?"ambiguous":"unmatched",
        label:"Muamalat → BNI",detail:match?
          "Both bank statements agree on date, amount, and sending bank. Not new income or consumption.":
          "No unique opposite-bank credit. Do not assume recipient account ownership."});
    }
    rows.sort((a,b)=>b.date.localeCompare(a.date) || b.amount-a.amount);
    return {rows,paired:rows.filter(r=>r.status==="paired").length,
      total:rows.filter(r=>r.status==="paired").reduce((n,r)=>n+r.amount,0),
      unresolved:rows.filter(r=>r.status!=="paired").length};
  }

  function jpPostLinks(data,asOf) {
    const rows=(data.jpPost||[]).filter(r=>validDate(day(r.date)) &&
      inRange(r.date,"2026-08-01",asOf) && ["+","-"].includes(r.sign) &&
      validMoney(r.amount_jpy) && str(r.evidence_key));
    const mapped=rows.map(bank=>{
      const matches=(data.cash||[]).filter(ledger=>jpyLedger(ledger) &&
        day(ledger.tanggal)===day(bank.date) &&
        str(ledger.note).includes("SRC="+str(bank.evidence_key)) &&
        (bank.sign==="+" ? sameMoney(ledger.pemasukan,bank.amount_jpy) &&
          num(ledger.pengeluaran)===0 : sameMoney(ledger.pengeluaran,bank.amount_jpy) &&
          num(ledger.pemasukan)===0));
      const linked=unique(matches);
      return {date:day(bank.date),amount:num(bank.amount_jpy),currency:"JPY",
        sign:bank.sign,label:str(bank.type)||"Japan Post Bank movement",
        status:linked?"linked":matches.length>1?"ambiguous":"source_only",
        ledgerId:linked?str(linked.id):null,evidenceKey:str(bank.evidence_key),
        detail:linked?"Original bank movement linked to one matching ledger record.":
          "Bank movement exists; not automatically an unrecorded purchase or missing income."};
    }).sort((a,b)=>b.date.localeCompare(a.date));
    return {rows:mapped,linked:mapped.filter(r=>r.status==="linked").length,
      sourceOnly:mapped.filter(r=>r.status==="source_only").length};
  }

  function visaPayments(data,asOf) {
    const evidence=(data.cardEvidence||[]).filter(r=>r.kind==="bank_payment" &&
      r.payload?.verified_from_bank===true && r.payload?.direction==="out" &&
      /hokuriku\s*visa/i.test(str(r.payload.payee)) &&
      validDate(day(r.payload.on)) &&
      inRange(r.payload.on,"2026-08-01",asOf) && validMoney(r.payload.amount_jpy));
    const mapped=evidence.map(item=>{
      const paymentDate=day(item.payload.on),amount=num(item.payload.amount_jpy);
      const candidates=(data.cash||[]).filter(r=>jpyLedger(r) &&
        day(r.tanggal)===paymentDate && sameMoney(r.pengeluaran,amount) &&
        num(r.pemasukan)===0 && (
          /Hokuriku VISA/i.test(str(r.item)) && /auto.debit|CC KU settlement/i.test(str(r.note)) ||
          str(r.kategori_normalized)==="Card Settlement" && /CC KU|Hokuriku VISA/i.test(str(r.note))
        ));
      const ledger=unique(candidates);
      return {date:paymentDate,amount,currency:"JPY",label:"Hokuriku VISA settlement",
        status:ledger?"linked":candidates.length>1?"ambiguous":"source_only",
        ledgerId:ledger?str(ledger.id):null,
        detail:ledger?"Bank-verified card settlement linked to one existing ledger debit; not a second purchase.":
          "Bank-verified card settlement has no unique ledger match. Do not create a purchase automatically."};
    }).sort((a,b)=>b.date.localeCompare(a.date));
    return {rows:mapped,linked:mapped.filter(r=>r.status==="linked").length,
      sourceOnly:mapped.filter(r=>r.status==="source_only").length};
  }

  function tokopediaSettlement(data,asOf) {
    const items=(data.tokopediaStatements||[]).filter(r=>validDate(day(r.statement_date)) &&
      inRange(r.statement_date,"2026-08-01",asOf) && validMoney(r.total_idr));
    const mapped=items.map(statement=>{
      const p=statement.payload||{}, d=day(p.payment_date);
      const bill=num(statement.total_idr);
      const bank=(data.bni||[]).filter(r=>r.sign==="-" &&
        day(r.date)===d && /TOKOPEDIA|PLSTOKOPEDIA/i.test(str(r.description)) &&
        validMoney(r.amount));
      const debit=unique(bank);
      const feeValue=validMoney(p.payment_fee_idr)?num(p.payment_fee_idr):null;
      const feeRows=feeValue===null?[]:(data.cash||[]).filter(r=>idrLedger(r) &&
        day(r.tanggal)===d && sameMoney(r.expense_idr,feeValue) &&
        num(r.pengeluaran)>0 && /TKP-PAYMENT-FEE/i.test(str(r.note)));
      const fee=unique(feeRows);
      const settlements=debit?(data.cash||[]).filter(r=>idrLedger(r) &&
        day(r.tanggal)===d && str(r.kategori_normalized||r.kategori)==="Card Settlement" &&
        sameMoney(-num(r.expense_idr),debit.amount) &&
        /tokopedia/i.test(str(r.item)+" "+str(r.note))):[];
      const settlement=unique(settlements);
      const exact=!!debit && !!settlement && !!fee && feeValue!==null &&
        sameMoney(num(debit.amount),bill+feeValue) &&
        (p.payment_bank_amount_idr===undefined ||
          sameMoney(debit.amount,p.payment_bank_amount_idr));
      return {date:d||day(statement.statement_date),currency:"IDR",
        label:"Tokopedia Card statement payment",amount:debit?num(debit.amount):bill,
        status:exact?"linked":bank.length>1 || feeRows.length>1 ||
          settlements.length>1?"ambiguous":"needs_review",
        ledgerId:settlement?str(settlement.id):null,
        detail:exact?"Bank debit equals statement bill plus separately posted payment fee; settlement is not another purchase.":
          "Card statement / BNI debit / settlement / fee not jointly verified. Do not infer fees or payment status."};
    });
    return {rows:mapped,linked:mapped.filter(r=>r.status==="linked").length};
  }

  function inspect(data={},opts={}) {
    const asOf=opts.asOf||todayTokyo();
    if(!validDate(asOf))return {ready:false,error:true,reason:"Invalid review date"};
    const sourceErrors=["bniError","muamalatError","jpPostLoadError",
      "cardEvidenceError","tokopediaStatementsError"].filter(k=>data[k]);
    const groups={
      interbank:muamalatBni(data,asOf),
      jpPost:jpPostLinks(data,asOf),
      visa:visaPayments(data,asOf),
      tokopedia:tokopediaSettlement(data,asOf)
    };
    const rows=[...groups.interbank.rows,...groups.jpPost.rows,...groups.visa.rows,
      ...groups.tokopedia.rows].sort((a,b)=>b.date.localeCompare(a.date) ||
      a.label.localeCompare(b.label));
    const review=rows.filter(r=>!["paired","linked"].includes(r.status));
    const available=["muamalat","bni","jpPost","cardEvidence","tokopediaStatements"]
      .filter(k=>Array.isArray(data[k])&&data[k].length>0);
    return {ready:available.length>0,asOf,groups,rows,review,
      sourceErrors,partial:sourceErrors.length>0,sourceAvailable:available.length,
      matched:rows.length-review.length};
  }

  let source={},currentFilter="all",initialized=false;
  function el(id){return document.getElementById(id);}
  function set(id,value){const n=el(id);if(n)n.textContent=String(value);}
  function element(tag,cls,text){
    const n=document.createElement(tag);if(cls)n.className=cls;
    if(text!==undefined)n.textContent=String(text);return n;
  }
  function render(){
    if(typeof document==="undefined")return;
    const root=el("multi-account-reconciliation");
    if(!root)return;
    const m=inspect(source);
    root.classList.toggle("hidden",!m.ready && !m.partial);
    if(!m.ready) {
      set("multi-account-status",m.partial?"Some source feeds unavailable":"No source data yet");
      return;
    }
    set("multi-account-status",m.partial?
      "Partial source data · checks incomplete":
      "Source evidence through "+m.asOf+" · no live bank connection");
    set("multi-account-interbank",(!Array.isArray(source.bni)||!Array.isArray(source.muamalat)||source.bniError||source.muamalatError)?
      "Source unavailable":m.groups.interbank.paired+" paired · "+currency(m.groups.interbank.total,"IDR"));
    set("multi-account-jp",source.jpPostLoadError||!Array.isArray(source.jpPost)?
      "Source unavailable":m.groups.jpPost.linked+"/"+m.groups.jpPost.rows.length+" ledger linked");
    set("multi-account-visa",source.cardEvidenceError||!Array.isArray(source.cardEvidence)?
      "Source unavailable":m.groups.visa.linked+"/"+m.groups.visa.rows.length+" ledger linked");
    set("multi-account-card",source.tokopediaStatementsError||!Array.isArray(source.tokopediaStatements)?
      "Source unavailable":m.groups.tokopedia.linked+"/"+m.groups.tokopedia.rows.length+" verified");
    set("multi-account-review-count",m.review.length+" source rows need review / remain unlinked");
    const list=el("multi-account-results");
    if(!list)return;
    list.replaceChildren();
    const filtered=m.rows.filter(r=>currentFilter==="all" ||
      (currentFilter==="review"&&!["paired","linked"].includes(r.status)) ||
      (currentFilter==="linked"&&["paired","linked"].includes(r.status)));
    for(const r of filtered.slice(0,70)){
      const div=element("div","multi-account-row");
      const body=element("span","multi-account-copy");
      body.append(element("strong","",r.label),
        element("small","",r.date+" · "+r.detail));
      const side=element("span","multi-account-side");
      side.append(element("strong","",currency(r.amount,r.currency)),
        element("small","",r.status.replaceAll("_"," ")));
      if(r.ledgerId){
        const btn=element("button","multi-account-open","View ledger #"+r.ledgerId);
        btn.type="button";btn.dataset.multiLedger=r.ledgerId;side.append(btn);
      }
      div.append(body,side);list.append(div);
    }
    if(!filtered.length)list.append(element("p","transfer-proof-muted","No rows in this filter."));
    set("multi-account-shown",Math.min(filtered.length,70)+" of "+filtered.length+" entries");
  }
  function setData(data={}) {source=data;render();}
  function init(){
    if(initialized)return;initialized=true;
    el("multi-account-reconciliation")?.addEventListener("click",event=>{
      const link=event.target.closest("[data-multi-ledger]");
      if(link){
        const id=Number(link.dataset.multiLedger);
        if(Number.isSafeInteger(id)&&id>0)
          window.dispatchEvent(new CustomEvent("budget:open-transaction",{detail:{id}}));
        return;
      }
      const filter=event.target.closest("[data-multi-filter]");
      if(filter){
        currentFilter=filter.dataset.multiFilter;
        el("multi-account-reconciliation").querySelectorAll("[data-multi-filter]").forEach(b=>
          b.classList.toggle("active",b===filter));
        render();
      }
    });
    render();
  }
  if(typeof window!=="undefined")window.FinanceMultiAccountReconciliation={init,setData,render};
  if(typeof module!=="undefined"&&module.exports)
    module.exports={inspect,muamalatBni,jpPostLinks,visaPayments,tokopediaSettlement};
})();