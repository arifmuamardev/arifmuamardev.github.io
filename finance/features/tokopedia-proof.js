(() => {
  "use strict";

  // Bank-app screenshots are evidence, not a live card feed or final e-statement.
  // A source row is consumed at most once, regardless of overlapping screenshots.
  let source = { evidence: [], cash: [], bni: [], error: false, statements: [], statementError: false };
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


  // Official PDF statement is a fixed billing-period snapshot, not a live balance.
  // Link exact original IDR values to already imported screenshot records.
  function reconcileStatement(statements,cash,loadError=false,bni=[]) {
    if(loadError)return {available:false,error:true,reason:"Official billing data could not be loaded."};
    const record=(Array.isArray(statements)?statements:[])
      .find(x=>x.evidence_key==="BRI-TOKOPEDIA-STATEMENT-2026-10-15");
    if(!record)return {available:false,error:false,reason:"No official statement uploaded."};
    const rows=Array.isArray(cash)?cash:[];
    const byId=new Map(rows.map(x=>[Number(x.id),x]));
    const charges=Array.isArray(record.payload?.charges)?record.payload.charges:[];
    const observed=new Set();
    const verified=charges.map(line=>{
      const id=Number(line.ledger_id);
      const r=byId.get(id);
      const matched=Boolean(
        r && id>0 && !observed.has(id) &&
        string(r.currency).toUpperCase()==="IDR" &&
        amount(r.expense_idr)===amount(line.amount_idr) &&
        date(r.tanggal)===date(line.transaction_date) &&
        string(r.note).includes("TKP-SHOT-")
      );
      if(matched)observed.add(id);
      return {...line, matched};
    });
    const feeId=Number(record.payload?.e_statement_fee_ledger_id);
    const fee=byId.get(feeId);
    const feeMatched=Boolean(fee && feeId>0 &&
      string(fee.currency)==="IDR" &&
      amount(fee.expense_idr)===amount(record.payload?.e_statement_fee_idr) &&
      date(fee.tanggal)===date(record.statement_date) &&
      string(fee.note).includes("BRI-TK-STAT-20261015-FEE"));
    const payId=Number(record.payload?.previous_payment_ledger_id);
    const payment=byId.get(payId);
    const priorPaymentMatched=Boolean(payment&&payId>0 &&
      amount(payment.expense_idr)===-amount(record.payload?.previous_payment_idr) &&
      string(payment.kategori_normalized)==="Card Settlement");
    const purchaseTotal=charges.reduce((sum,line)=>sum+amount(line.amount_idr),0);
    const allChargesMatched=verified.length===9 && verified.every(x=>x.matched);
    const totalEquation=purchaseTotal + amount(record.payload?.e_statement_fee_idr)===amount(record.total_idr);
    const paidCash=byId.get(Number(record.payload?.payment_ledger_id));
    const bank=(Array.isArray(bni)?bni:[]).find(x=>Number(x.id)===Number(record.payload?.payment_bni_id));
    const bankAmount=amount(record.payload?.payment_bank_amount_idr);
    const paymentDate=date(record.payload?.payment_date);
    const paymentDifference=bankAmount-amount(record.total_idr);
    const currentPaymentMatched=Boolean(
      paidCash && bank && bankAmount>0 &&
      string(paidCash.currency)==="IDR" && string(paidCash.kategori_normalized)==="Card Settlement" &&
      amount(paidCash.expense_idr)===-bankAmount &&
      date(paidCash.tanggal)===paymentDate &&
      string(paidCash.note).includes("BNI-SCREEN-20261018-TOKOPEDIA-1774506") &&
      string(bank.sign)==="-" && amount(bank.amount)===bankAmount &&
      date(bank.date)===paymentDate &&
      /TOKOPEDIA/i.test(string(bank.description)) &&
      amount(record.payload?.payment_statement_total_idr)===amount(record.total_idr) &&
      amount(record.payload?.payment_difference_idr)===paymentDifference
    );
    return {available:true,record,charges:verified,fee,feeMatched,priorPaymentMatched,
      currentPaymentMatched,paymentAmount:bankAmount,paymentDifference,paymentDate,
      allChargesMatched,totalEquation,purchasesTotal:purchaseTotal,
      matchedCharges:verified.filter(x=>x.matched).length,
      checksPassed:allChargesMatched&&feeMatched&&priorPaymentMatched&&totalEquation,
      cardAvailableCredit:Number(record.available_credit_idr),
      usedCredit:amount(record.credit_limit_idr)-amount(record.available_credit_idr)};
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

  function renderOfficialStatement() {
    const statement=reconcileStatement(source.statements,source.cash,source.statementError,source.bni);
    const section=document.getElementById("tokopedia-official-statement");
    const missing=document.getElementById("tokopedia-official-missing");
    if(!statement.available){
      section?.classList.add("hidden");
      if(missing) {
        missing.classList.toggle("hidden",!statement.error);
        missing.textContent=statement.error?statement.reason:"";
      }
      return statement;
    }
    section?.classList.remove("hidden");
    missing?.classList.add("hidden");
    const s=statement.record;
    put("tokopedia-official-total",idr(s.total_idr));
    put("tokopedia-official-due",date(s.due_date));
    put("tokopedia-official-issued",date(s.statement_date));
    put("tokopedia-official-minimum",idr(s.card_minimum_idr));
    put("tokopedia-official-combined-minimum",idr(s.all_cards_minimum_idr));
    put("tokopedia-official-purchases",statement.matchedCharges+"/9 · "+idr(statement.purchasesTotal));
    put("tokopedia-official-fee",idr(s.payload?.e_statement_fee_idr));
    put("tokopedia-official-credit",idr(s.available_credit_idr));
    put("tokopedia-official-match",statement.checksPassed?
      "Verified: 9 existing charges + 1 unique fee + prior repayment":
      "Attention: one or more statement-to-ledger links need review");
    put("tokopedia-official-status",statement.currentPaymentMatched
      ? "PAID via BNI virtual account on "+statement.paymentDate+". Bank debit "+
        idr(statement.paymentAmount)+" against statement "+idr(s.total_idr)+
        ". Difference "+idr(statement.paymentDifference)+
        " remains unexplained; no extra fee was invented. The card payment is a settlement, not new spending."
      : "This statement's settlement is not verified by linked bank and ledger records. "+
        "Card purchases and the previous month's payment are tracked separately.");
    const list=document.getElementById("tokopedia-official-lines");
    if(list){
      list.replaceChildren();
      for(const line of statement.charges){
        const row=ele("div","tokopedia-proof-pair");
        row.append(ele("span","",line.description+" · "+line.transaction_date),
          ele("strong","",idr(line.amount_idr)+(line.matched?" · linked":" · review")));
        list.append(row);
      }
      const feeRow=ele("div","tokopedia-proof-pair");
      feeRow.append(ele("span","","E-statement service fee · "+date(s.statement_date)),
        ele("strong","",idr(s.payload?.e_statement_fee_idr)+(statement.feeMatched?" · linked":" · review")));
      list.append(feeRow);
    }
    return statement;
  }
  function render(){
    const official=renderOfficialStatement();
    const m=reconcile(source.evidence,source.cash,source.error);
    const empty=document.getElementById("tokopedia-proof-unavailable");
    const content=document.getElementById("tokopedia-proof-content");
    if(!m.available) {
      if(empty){empty.classList.remove("hidden");empty.textContent=m.reason;}
      if(content)content.classList.add("hidden");return;
    }
    if(empty)empty.classList.add("hidden");
    if(content)content.classList.remove("hidden");
    put("tokopedia-proof-limit",idr(official.available?
      official.record.credit_limit_idr:m.limits.credit_limit_idr));
    put("tokopedia-proof-used",idr(official.available?
      official.usedCredit:m.limits.used_idr));
    put("tokopedia-proof-available",idr(official.available?
      official.cardAvailableCredit:m.limits.available_idr));
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
      cash:Array.isArray(data.cash)?data.cash:[],error:!!data.loadError,
      statements:Array.isArray(data.statements)?data.statements:[],
      bni:Array.isArray(data.bni)?data.bni:[],
      statementError:!!data.statementLoadError};
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
    module.exports={snapshotForTest:reconcile,statementForTest:reconcileStatement};
})();