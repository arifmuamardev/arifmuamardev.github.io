(() => {
  "use strict";

  // Ledger review only: original signed values and source-account rows stay intact.
  // Matching a debit proves a possible counterpart, never the recipient's purpose.
  const str=x=>String(x??"").trim();
  const num=x=>Number(x)||0;
  const date=x=>str(x).slice(0,10);
  const money=(v,c)=>c==="IDR"?
    "Rp"+new Intl.NumberFormat("id-ID",{maximumFractionDigits:0}).format(v):
    "¥"+new Intl.NumberFormat("ja-JP",{maximumFractionDigits:2}).format(v);
  const hasAmount=x=>x!==null&&x!==undefined&&x!==""&&Number.isFinite(Number(x))&&Number(x)>0;

  function tokyoToday(){
    const parts=Object.fromEntries(new Intl.DateTimeFormat("en-CA",{
      timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"
    }).formatToParts(new Date()).filter(v=>v.type!=="literal").map(v=>[v.type,v.value]));
    return parts.year+"-"+parts.month+"-"+parts.day;
  }

  function matchingSource(ledger,bni=[],muamalat=[]){
    if(str(ledger.currency)!=="IDR"||!hasAmount(ledger.expense_idr))
      return {status:"source unavailable",count:0,accounts:[]};
    const candidates=[["BNI",bni],["Muamalat",muamalat]].flatMap(([account,rows])=>
      (Array.isArray(rows)?rows:[]).filter(bank=>
        bank.sign==="-"&&date(bank.date)===date(ledger.tanggal)&&
        hasAmount(bank.amount)&&Math.abs(Number(bank.amount)-Number(ledger.expense_idr))<=1
      ).map(bank=>({account,bankId:str(bank.id),description:str(bank.description)})));
    return {status:candidates.length===1?"single bank candidate":
      candidates.length>1?"ambiguous source candidates":"no matching bank debit",
      count:candidates.length,
      accounts:[...new Set(candidates.map(c=>c.account))]};
  }

  function guidance(row,kind){
    const name=str(row.item);
    if(kind==="recipient")return "Confirm purpose: family support, purchase/service, loan, reimbursement or own-account transfer. A matched bank debit does not decide this.";
    if(/bank transfer|payment/i.test(name))return "Check the bank beneficiary and receipt; this may be a transfer or a payment, not necessarily consumption.";
    if(/PAYPAL/i.test(name))return "Identify the merchant in PayPal activity or its invoice before assigning a spending category.";
    if(/CC KU|credit card|tokopedia card/i.test(str(row.note)))return "Check the original card receipt to determine the product or service.";
    if(kind==="zero")return "Zero monetary impact: confirm whether this placeholder should remain archived.";
    return "Check the original receipt or card statement to identify the transaction purpose.";
  }

  function inspect(data={},opts={}){
    const asOf=opts.asOf||tokyoToday();
    const cash=Array.isArray(data.cash)?data.cash:[];
    const bni=Array.isArray(data.bni)?data.bni:[];
    const muamalat=Array.isArray(data.muamalat)?data.muamalat:[];
    const rows=cash.filter(r=>date(r.tanggal)&&date(r.tanggal)<=asOf);
    const unknown=rows.filter(r=>
      ["Others","Lain-lain",""].includes(str(r.kategori_normalized)) &&
      str(r.kategori_normalized)!=="Transfers & Movements");
    // Account movements are not automatically household spending even if the
    // recipient is named. Restrict this queue to explicit recipient transfers.
    const recipients=rows.filter(r=>
      str(r.kategori_normalized)==="Transfers & Movements" &&
      num(r.pengeluaran)>0 &&
      /^transfer\s+(?:ke|to)\s+/i.test(str(r.item)) &&
      !/^(?:transfer\s+(?:ke|to)\s+(?:own|self|my|bank\s+(?:own|self)))/i.test(str(r.item))
    );
    const make=(r,kind)=>{
      const native=str(r.currency)==="IDR"&&hasAmount(r.expense_idr)?
        Number(r.expense_idr):num(r.pengeluaran);
      const record={
        id:Number(r.id),date:date(r.tanggal),name:str(r.item)||str(r.item_normalized),
        kind,currency:str(r.currency)==="IDR"?"IDR":"JPY",
        originalAmount:native,yenAmount:num(r.pengeluaran),
        source:kind==="recipient"?matchingSource(r,bni,muamalat):
          {status:"purpose unresolved",count:0,accounts:[]},
        nextStep:guidance(r,kind)
      };
      return record;
    };
    const unknownPayments=unknown.filter(r=>num(r.pengeluaran)>0)
      .map(r=>make(r,"unknown"));
    const zeroRecords=unknown.filter(r=>num(r.pengeluaran)===0&&num(r.pemasukan)===0)
      .map(r=>make(r,"zero"));
    const recipientRows=recipients.map(r=>make(r,"recipient"));
    const priority={unknown:0,recipient:1,zero:2};
    const all=[...unknownPayments,...recipientRows,...zeroRecords]
      .sort((a,b)=>priority[a.kind]-priority[b.kind] ||
        b.yenAmount-a.yenAmount || b.date.localeCompare(a.date));
    const yen=x=>Math.round(x*100)/100;
    return {
      ready:Array.isArray(data.cash),
      all, unknownPayments, zeroRecords,recipientRows,
      unknownValueYen:yen(unknownPayments.reduce((s,x)=>s+x.yenAmount,0)),
      recipientOriginalIDR:recipientRows.filter(x=>x.currency==="IDR")
        .reduce((s,x)=>s+x.originalAmount,0),
      recipientSourceCandidate:recipientRows.filter(x=>x.source.count===1).length,
      recipientSourceAmbiguous:recipientRows.filter(x=>x.source.count>1).length,
      pendingPurpose:unknownPayments.length+recipientRows.length,
      note:"Categorization and ownership require review; no ledger edits have been made."
    };
  }
  let dataset={},filter="all",initialized=false;
  const el=id=>document.getElementById(id);
  const put=(id,v)=>{const target=el(id);if(target)target.textContent=String(v);};
  const node=(tag,cls,text)=>{
    const n=document.createElement(tag);if(cls)n.className=cls;
    if(text!==undefined)n.textContent=String(text);
    return n;
  };
  function render(){
    if(typeof document==="undefined")return;
    const root=el("purpose-review");
    if(!root)return;
    const m=inspect(dataset);
    root.classList.toggle("hidden",!m.ready);
    if(!m.ready)return;
    put("purpose-review-unknown",m.unknownPayments.length+" entries · "+money(m.unknownValueYen,"JPY"));
    put("purpose-review-recipient",m.recipientRows.length+" entries · "+
      money(m.recipientOriginalIDR,"IDR"));
    put("purpose-review-bank",m.recipientSourceCandidate+"/"+m.recipientRows.length+
      " with a single same-day bank debit");
    put("purpose-review-count",m.pendingPurpose+" monetary entries to review"+
      (m.zeroRecords.length?" · "+m.zeroRecords.length+" zero-value historical item":""));
    const list=el("purpose-review-list");if(!list)return;
    list.replaceChildren();
    const selected=m.all.filter(r=>filter==="all"||r.kind===filter);
    for(const item of selected.slice(0,100)){
      const row=node("div","purpose-review-entry");
      const main=node("div","purpose-review-copy");
      main.append(node("strong","",item.name),
        node("small","",item.date+" · "+(item.kind==="recipient"?
          "Recipient transfer · purpose unverified":item.kind==="zero"?
          "No money movement":"Unclassified spending/payment")));
      main.append(node("p","",item.nextStep));
      if(item.kind==="recipient"){
        main.append(node("small","",item.source.status+
          (item.source.accounts.length?" · "+item.source.accounts.join(" / "):"")+
          ". Bank-side match ≠ purpose verification."));
      }
      const side=node("div","purpose-review-side");
      side.append(node("strong","",money(item.originalAmount,item.currency)));
      if(item.currency==="IDR")
        side.append(node("small","","Stored equivalent "+money(item.yenAmount,"JPY")));
      const open=node("button","purpose-review-open","Inspect record #"+item.id);
      open.type="button";open.dataset.purposeId=String(item.id);side.append(open);
      row.append(main,side);list.append(row);
    }
    if(!selected.length)list.append(node("p","flow-audit-muted","No entries in this filter."));
    put("purpose-review-shown",Math.min(selected.length,100)+" of "+selected.length+" entries");
  }
  function setData(next={}){dataset=next;render();}
  function init(){
    if(initialized)return;initialized=true;
    const root=el("purpose-review");
    root?.addEventListener("click",event=>{
      const transaction=event.target.closest("[data-purpose-id]");
      if(transaction){
        const id=Number(transaction.dataset.purposeId);
        if(Number.isSafeInteger(id)&&id>0)
          window.dispatchEvent(new CustomEvent("budget:open-transaction",{detail:{id}}));
        return;
      }
      const button=event.target.closest("[data-purpose-filter]");
      if(button){
        filter=button.dataset.purposeFilter;
        root.querySelectorAll("[data-purpose-filter]").forEach(x=>
          x.classList.toggle("active",x===button));
        render();
      }
    });
    render();
  }
  if(typeof window!=="undefined")window.FinancePurposeReview={init,setData,render};
  if(typeof module!=="undefined"&&module.exports)module.exports={inspect,matchingSource,guidance};
})();