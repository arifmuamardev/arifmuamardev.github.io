(() => {
  "use strict";

  // Bank-app screenshots are evidence, not a live card feed or final e-statement.
  // A source row is consumed at most once, regardless of overlapping screenshots.
  let source = { evidence: [], cash: [], error: false };
  let filter = "all";
  const amount = x => Number(x) || 0;
  const string = x => String(x ?? "");
  const date = x => string(x).slice(0, 10);
  const idr = x => "Rp" + new Intl.NumberFormat("id-ID", {maximumFractionDigits:0}).format(amount(x));
  const isoDayDistance = (a,b) => {
    const x=Date.parse(date(a)+"T00:00:00Z"), y=Date.parse(date(b)+"T00:00:00Z");
    return Number.isFinite(x)&&Number.isFinite(y)?Math.abs(x-y)/86400000:Infinity;
  };
  const norm = x => string(x).normalize("NFKC").toUpperCase().replace(/[^A-Z0-9\u3040-\u30FF\u3400-\u9FFF]/g,"");
  function noteHasCard(row) {
    const n=string(row.note).toLowerCase();
    return n.includes("tokopedia card") || n.includes("tkp-shot-") ||
      (n.includes("cc") && !n.includes("cc ku"));
  }
  function merchantCompatible(line, row) {
    const merchant=norm(line.merchant);
    const candidates=[row.item,row.item_normalized,row.tempat].map(norm);
    const tokens=merchant.split(/(?<=\w)(?=\d)/g).filter(t=>t.length>=5);
    return merchant.length>=5 &&
      candidates.some(c => c.length>=5 && (c.includes(merchant) || merchant.includes(c))) ||
      tokens.some(t=>candidates.some(c=>c.includes(t))) && merchant.length>=5;
  }
  function reconcile(evidence,cash,error=false) {
    if (error) return {available:false,reason:"Tokopedia Card evidence could not be loaded."};
    const rows=Array.isArray(evidence)?evidence:[];
    const byKey=new Map(rows.map(x=>[x.evidence_key,x]));
    const limits=byKey.get("tokopedia_limits_20261014")?.payload;
    const proof=byKey.get("tokopedia_transactions_20261014")?.payload;
    if (!limits || !Array.isArray(proof?.lines))
      return {available:false,reason:"Tokopedia Card screenshots are not available to this account."};

    // Source IDs deduplicate the Sep transactions shown again in Oct screenshots.
    const unique=new Map();
    for(const line of proof.lines) if(line.source_id && !unique.has(line.source_id))
      unique.set(line.source_id,line);
    const lines=[...unique.values()];
    const used=new Set();
    const ledger=(Array.isArray(cash)?cash:[]).filter(x=>
      string(x.currency).toUpperCase()==="IDR" && noteHasCard(x));
    const mapped=lines.map(line=>{
      const marker=string(line.source_id);
      const options=ledger.filter(row=>!used.has(string(row.id)) &&
        string(row.note).includes(marker) && row.expense_idr!==null &&
        Math.abs(Math.abs(amount(row.expense_idr))-amount(line.amount_idr))<=1);
      let match=options[0];
      let method=match?"source tag":null;
      if (!match && line.status==="posted") {
        // Date and IDR amount alone are insufficient: require the same
        // card source AND credible merchant identity within one day.
        const choices=ledger.filter(row=>!used.has(string(row.id)) &&
          amount(row.expense_idr)>0 && Math.abs(amount(row.expense_idr)-amount(line.amount_idr))<=1 &&
          isoDayDistance(row.tanggal,line.date)<=1 && merchantCompatible(line,row));
        choices.sort((a,b)=>isoDayDistance(a.tanggal,line.date)-isoDayDistance(b.tanggal,line.date)||
          Number(a.id||0)-Number(b.id||0));
        match=choices[0];
        method=match?"merchant/date/amount":null;
      }
      if(match) used.add(string(match.id));
      let state=line.status==="pending"?"pending":line.status==="payment"?"payment":
        match?method==="source tag"?"imported":"candidate":"unmatched";
      if(line.status==="payment" && match) state="payment";
      return {...line,state,ledgerId:match?Number(match.id):null,matchMethod:method};
    });
    const byStatus=status=>mapped.filter(x=>x.state===status);
    const sumStatus=status=>byStatus(status).reduce((n,x)=>n+amount(x.amount_idr),0);
    const posted=mapped.filter(x=>x.status==="posted");
    const sumPosted=posted.reduce((n,x)=>n+amount(x.amount_idr),0);
    const settled=mapped.filter(x=>x.status==="payment");
    return {
      available:true,limits,proof,lines:mapped,
      checks:{limitEquation:amount(limits.credit_limit_idr)-amount(limits.used_idr)===amount(limits.available_idr),
        uniqueSources:mapped.length===unique.size,
        noDoubleCount:used.size===mapped.filter(x=>x.ledgerId!==null).length},
      counts:{posted:posted.length,imported:byStatus("imported").length,
        candidates:byStatus("candidate").length,missing:byStatus("unmatched").length,
        pending:byStatus("pending").length,payment:settled.length},
      totals:{posted:sumPosted,imported:sumStatus("imported"),missing:sumStatus("unmatched"),
        pending:sumStatus("pending"),settled:settled.reduce((n,x)=>n+amount(x.amount_idr),0)}
    };
  }

  function ele(tag,cls,text){
    const n=document.createElement(tag);
    if(cls)n.className=cls;
    if(text!==undefined)n.textContent=string(text);
    return n;
  }
  function put(id,val){const node=document.getElementById(id);if(node)node.textContent=string(val);}
  function stateName(row) {
    if(row.state==="pending")return "Pending · not in ledger";
    if(row.state==="payment")return row.ledgerId?"Payment · neutral ledger":"Payment evidence only";
    if(row.state==="imported")return "Imported · source-linked";
    if(row.state==="candidate")return "Matched candidate · review";
    return "Needs ledger review";
  }
  function renderRows(model) {
    const parent=document.getElementById("tokopedia-proof-rows");
    if(!parent)return;
    parent.replaceChildren();
    const selected=model.lines.filter(x=>filter==="all"||
      (filter==="posted"&&x.status==="posted")||
      (filter==="pending"&&x.status==="pending")||
      (filter==="payments"&&x.status==="payment")||
      (filter==="unmatched"&&x.state==="unmatched"));
    for(const line of selected){
      const row=ele("div","tokopedia-proof-row");
      const main=ele("div","tokopedia-proof-row-main");
      main.append(ele("strong","",line.merchant));
      main.append(ele("small","",line.date+" · "+line.source_id));
      const amt=ele("strong","tokopedia-proof-amount",(line.status==="payment"?"+":"−")+idr(line.amount_idr));
      const state=ele("span","tokopedia-proof-status tokopedia-proof-"+line.state,stateName(line));
      row.append(main,amt,state);
      if(line.ledgerId!==null) {
        const btn=ele("button","tokopedia-proof-detail","Ledger #"+line.ledgerId);
        btn.type="button";btn.dataset.tokopediaLedger=string(line.ledgerId);
        row.append(btn);
      }
      const hint=ele("small","tokopedia-proof-row-hint",line.normalized_item+
        (line.confidence==="low"?" · category inferred; verify":""));
      row.append(hint);
      parent.append(row);
    }
    if(!selected.length)parent.append(ele("p","tokopedia-proof-muted","No rows for this filter."));
  }
  function render(){
    const m=reconcile(source.evidence,source.cash,source.error);
    const empty=document.getElementById("tokopedia-proof-unavailable");
    const content=document.getElementById("tokopedia-proof-content");
    if(!m.available) {
      if(empty){empty.classList.remove("hidden");empty.textContent=m.reason;}
      if(content)content.classList.add("hidden");return;
    }
    if(empty)empty.classList.add("hidden");
    if(content)content.classList.remove("hidden");
    put("tokopedia-proof-limit",idr(m.limits.credit_limit_idr));
    put("tokopedia-proof-used",idr(m.limits.used_idr));
    put("tokopedia-proof-available",idr(m.limits.available_idr));
    put("tokopedia-proof-posted",m.counts.posted+" · "+idr(m.totals.posted));
    put("tokopedia-proof-imports",m.counts.imported+" · "+idr(m.totals.imported));
    put("tokopedia-proof-missing",m.counts.missing+" · "+idr(m.totals.missing));
    put("tokopedia-proof-pending",m.counts.pending+" · "+idr(m.totals.pending));
    put("tokopedia-proof-payment",m.counts.payment+" · "+idr(m.totals.settled));
    put("tokopedia-proof-equation",m.checks.limitEquation?"Verified":"Review required");
    put("tokopedia-proof-capture",m.proof.captured_at?.slice(0,10)||"—");
    const status=document.getElementById("tokopedia-proof-warning");
    if(status)status.textContent=(m.counts.missing===0?
      "All posted screenshot transactions have a uniquely linked ledger record. ":
      m.counts.missing+" posted screenshot transaction(s) need ledger review. ") +
      "The available credit is not a statement balance. Payment is not income or an additional purchase. Pending transactions are evidence-only until posted. Matching recurring installments across DIFFERENT months must not erase valid monthly charges.";
    renderRows(m);
  }
  function setData(data={}) {
    source={evidence:Array.isArray(data.evidence)?data.evidence:[],
      cash:Array.isArray(data.cash)?data.cash:[],error:!!data.loadError};
    render();
  }
  function init(){
    const root=document.getElementById("view-tokopedia-proof");
    root?.addEventListener("click",event=>{
      const target=event.target.closest("[data-tokopedia-ledger]");
      if(target) {
        const id=Number(target.dataset.tokopediaLedger);
        if(Number.isFinite(id))
          window.dispatchEvent(new CustomEvent("budget:open-transaction",{detail:{id}}));
        return;
      }
      const option=event.target.closest("[data-tokopedia-filter]");
      if(option){
        filter=option.dataset.tokopediaFilter;
        for(const button of root.querySelectorAll("[data-tokopedia-filter]"))
          button.classList.toggle("active",button===option);
        render();
      }
    });
    render();
  }
  if(typeof window!=="undefined")window.FinanceTokopediaProof={init,setData,render};
  if(typeof module!=="undefined"&&module.exports)
    module.exports={snapshotForTest:reconcile};
})();