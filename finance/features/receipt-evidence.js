(() => {
  "use strict";

  // Private evidence registry; never changes ledger rows or balance history.
  let received={receipts:[],cash:[],loadError:false};
  const str=x=>String(x??"");
  const number=x=>Number(x)||0;
  const date=x=>str(x).slice(0,10);
  const money=(cur,value)=>{
    const prefix=cur==="IDR"?"Rp":cur==="TWD"?"NT$":"¥";
    return prefix+new Intl.NumberFormat(cur==="IDR"?"id-ID":"ja-JP",
      {maximumFractionDigits:cur==="JPY"?2:0}).format(number(value));
  };
  function reconcile(receipts=[],ledger=[],loadError=false) {
    if(loadError)return {available:false,reason:"Private receipt evidence failed to load."};
    const rows=Array.isArray(receipts)?receipts:[];
    const seen=new Set();
    const cashById=new Map((Array.isArray(ledger)?ledger:[]).map(x=>[Number(x.id),x]));
    const items=rows.map(x=>{
      const key=str(x.evidence_key),type=str(x.status);
      const duplicateSource=seen.has(key);
      seen.add(key);
      const link=x.linked_ledger_id===null||x.linked_ledger_id===undefined
        ? null:cashById.get(Number(x.linked_ledger_id))||null;
      const sourceFile=str(x.payload?.source_file);
      const expectedStored=type==="posted"? str(link?.note).includes(key):
        type==="already_recorded"?Boolean(link):false;
      const linkOk=type==="pending"?x.linked_ledger_id==null:
        Boolean(link)&&expectedStored;
      return {
        key,type,date:date(x.receipt_date),merchant:str(x.merchant),
        currency:str(x.source_currency),amount:number(x.source_amount),
        sourceFile,linkedId:link?Number(link.id):null,
        linkedAs:Number(x.linked_ledger_id),duplicateSource,
        linkOk,verifiedAmount:type==="posted"&&link
          ? (str(link.currency)==="IDR"?Math.abs(number(link.expense_idr)-number(x.source_amount))<=1:
            Math.abs(number(link.pengeluaran)-number(x.source_amount))<=0.01)
          : null
      };
    }).sort((a,b)=>b.date.localeCompare(a.date)||a.key.localeCompare(b.key));
    return {
      available:true,items,total:items.length,
      posted:items.filter(x=>x.type==="posted").length,
      existing:items.filter(x=>x.type==="already_recorded").length,
      pending:items.filter(x=>x.type==="pending").length,
      suspect:items.filter(x=>x.duplicateSource || !x.linkOk || x.verifiedAmount===false).length
    };
  }
  function node(tag,cls,txt) {
    const el=document.createElement(tag);
    if(cls)el.className=cls;
    if(txt!==undefined)el.textContent=str(txt);
    return el;
  }
  const put=(id,txt)=>{const x=document.getElementById(id);if(x)x.textContent=str(txt)};
  function render() {
    const m=reconcile(received.receipts,received.cash,received.loadError);
    const report=document.getElementById("receipt-evidence-list");
    if(!report)return;
    report.replaceChildren();
    if(!m.available) {
      report.append(node("p","receipt-evidence-warning",m.reason));
      return;
    }
    put("receipt-evidence-posted",m.posted);
    put("receipt-evidence-skipped",m.existing);
    put("receipt-evidence-pending",m.pending);
    put("receipt-evidence-check",m.suspect?
      m.suspect+" evidence link(s) need review":
      "All posted and duplicate source links agree with saved ledger records");
    for(const item of m.items) {
      const container=node("article","receipt-evidence-entry");
      const copy=node("span","receipt-evidence-copy");
      copy.append(node("strong","",item.merchant));
      copy.append(node("small","",item.date+" · "+money(item.currency,item.amount)));
      const type=item.type==="posted"?"Imported":
        item.type==="already_recorded"?"Already recorded":
        item.type==="pending"?"Pending in screenshot":"Review";
      copy.append(node("small","",type+(item.sourceFile?" · source: "+item.sourceFile:"")));
      if(item.type==="pending")
        copy.append(node("small","", "No ledger expense was added; check whether it settled later."));
      container.append(copy);
      if(item.linkedId!==null) {
        const btn=node("button","receipt-evidence-action","View ledger #"+item.linkedId);
        btn.type="button";btn.dataset.receiptLedger=String(item.linkedId);
        container.append(btn);
      }
      report.append(container);
    }
    if(!m.items.length)report.append(node("p","receipt-evidence-empty","No receipt evidence imported yet."));
  }
  function setData(data={}) {
    received={
      receipts:Array.isArray(data.receipts)?data.receipts:[],
      cash:Array.isArray(data.cash)?data.cash:[],
      loadError:!!data.loadError
    };render();
  }
  function init() {
    document.getElementById("receipt-evidence-list")?.addEventListener("click",event=>{
      const btn=event.target.closest("[data-receipt-ledger]");
      if(!btn)return;
      const id=Number(btn.dataset.receiptLedger);
      if(Number.isFinite(id))
        window.dispatchEvent(new CustomEvent("budget:open-transaction",{detail:{id}}));
    });
    render();
  }
  if(typeof window!=="undefined")window.FinanceReceiptEvidence={init,setData,render};
  if(typeof module!=="undefined"&&module.exports)module.exports={reconcileForTest:reconcile};
})();
