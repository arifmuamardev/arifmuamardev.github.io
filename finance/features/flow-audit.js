(() => {
  "use strict";
  let rows=[];
  let mode="month";
  const getDate=()=>Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"
  }).formatToParts(new Date()).filter(p=>p.type!=="literal").map(x=>[x.type,x.value]));
  const fmt=x=>"¥"+new Intl.NumberFormat("ja-JP",{maximumFractionDigits:2}).format(Number(x)||0);
  const put=(id,val)=>{const e=document.getElementById(id);if(e)e.textContent=String(val);};
  function model(asOf=null) {
    const d=getDate(),today=d.year+"-"+d.month+"-"+d.day;
    const source=rows.filter(row => {
      const date=String(row.tanggal||"").slice(0,10);
      return date && date<=today && (mode==="all" || date.slice(0,7)===today.slice(0,7));
    });
    return window.FinanceFlowClassifier?.tally(source,asOf) || null;
  }
  function render(){
    if(!window.FinanceFlowClassifier)return;
    const m=model();
    if(!m)return;
    put("flow-audit-raw",fmt(m.rawOut));
    put("flow-audit-consumption",fmt(m.spending));
    put("flow-audit-movement",fmt(m.movementOut));
    put("flow-audit-repayment",fmt(m.settlementOut));
    put("flow-audit-lending",fmt(m.loanOut));
    put("flow-audit-adjustments",fmt(m.adjustmentOut));
    put("flow-audit-uncertain",fmt(m.unclassifiedOut));
    put("flow-audit-income",fmt(m.income));
    put("flow-audit-incoming-moves",fmt(m.movementIn));
    put("flow-audit-source",m.records+" posted ledger records · "+(mode==="all"?"all history":"current month"));
    put("flow-audit-check",Math.abs(m.outflowGap)<.02 && Math.abs(m.inflowGap)<.02
      ? "All raw inflows/outflows allocated to one class"
      : "Classification sum differs from raw ledger — review");
    put("flow-audit-reviewed",m.review.length);
    const list=document.getElementById("flow-audit-review-list");
    if(list){
      list.replaceChildren();
      if(!m.review.length) {
        const p=document.createElement("p");p.className="flow-audit-muted";
        p.textContent="No ambiguous source classifications in this period.";list.append(p);
      }
      for(const item of m.review.slice(0,20)){
        const btn=document.createElement("button");
        btn.type="button";btn.className="flow-audit-entry";btn.dataset.flowAuditTransaction=String(item.id);
        const main=document.createElement("span");
        const title=document.createElement("strong");title.textContent=item.title;
        const sub=document.createElement("small");sub.textContent=item.tanggal+" · "+item.reason;
        main.append(title,sub);
        const amount=document.createElement("span");amount.textContent=fmt(item.amount);
        btn.append(main,amount);list.append(btn);
      }
      if(m.review.length>20){
        const p=document.createElement("p");p.className="flow-audit-muted";
        p.textContent="Showing 20 of "+m.review.length+" review candidates.";list.append(p);
      }
    }
  }
  function setData(next={}){rows=Array.isArray(next.cash)?next.cash:[];render();}
  function init(){
    document.getElementById("view-flow-audit")?.addEventListener("click",event=>{
      const entry=event.target.closest("[data-flow-audit-transaction]");
      if(entry){
        const id=Number(entry.dataset.flowAuditTransaction);
        if(Number.isFinite(id))
          window.dispatchEvent(new CustomEvent("budget:open-transaction",{detail:{id}}));
        return;
      }
      const period=event.target.closest("[data-flow-audit-period]");
      if(period){
        mode=period.dataset.flowAuditPeriod;
        document.querySelectorAll("[data-flow-audit-period]").forEach(el=>
          el.classList.toggle("active",el===period));
        render();
      }
    });
    render();
  }
  if(typeof window!=="undefined")window.FinanceFlowAudit={init,setData,render};
})();
