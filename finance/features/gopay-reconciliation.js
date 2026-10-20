(() => {
  "use strict";
  // Read-only cross-account checks. Never create purchases from statement mirrors.
  const MONTH = "2026-09";
  const STATEMENT = "GOPAY-ESTATEMENT-202609";
  const str = value => String(value ?? "").trim();
  const date = value => str(value).slice(0, 10);
  const num = value => Number(value);
  const validAmount = value => value !== null && value !== undefined &&
    value !== "" && Number.isFinite(num(value)) && num(value) > 0;
  const equal = (a, b) => validAmount(a) && validAmount(b) && Math.abs(num(a) - num(b)) < 0.01;
  const rupiah = amount => "Rp" + new Intl.NumberFormat("id-ID", {maximumFractionDigits: 0}).format(amount);
  const september = row => date(row?.date).slice(0, 7) === MONTH;

  function reconcile(input = {}) {
    const receipts = Array.isArray(input.receipts) ? input.receipts : [];
    const gopay = Array.isArray(input.gopay) ? input.gopay : [];
    const bni = Array.isArray(input.bni) ? input.bni : [];
    const cash = Array.isArray(input.cash) ? input.cash : [];
    const statement = receipts.find(row => row.evidence_key === STATEMENT);
    const sourceRows = Array.isArray(statement?.payload?.source_rows) ?
      statement.payload.source_rows : [];
    if (input.loadError || !statement || sourceRows.length === 0) {
      return {ready: false, error: !!input.loadError, pairs: [], matched: 0, total: 0,
        feesMatched: 0, feeTotal: 0, cardMatched: 0, cardTotal: 0, coinsExceptions: [],
        missing: 0, ambiguous: 0};
    }
    const topups = sourceRows.filter(row => row.type === "Top Up" && row.sign === "+" &&
      date(row.date).slice(0, 7) === MONTH && validAmount(row.amount));
    const selected = [];
    const usedGoPay = new Set(), usedBNI = new Set();
    for (const original of topups) {
      const g = gopay.filter(row => september(row) && row.sign === "+" &&
        /^top\s*up$/i.test(str(row.type)) && equal(row.amount, original.amount) &&
        !usedGoPay.has(str(row.id)));
      const b = bni.filter(row => september(row) && row.sign === "-" &&
        date(row.date) === date(original.date) && equal(row.amount, original.amount) &&
        /top\s*up\s*gopay/i.test(str(row.description)) && !usedBNI.has(str(row.id)));
      // Different rows on the same day are not interchangeable solely by value.
      const sameDateGoPay = g.filter(row => date(row.date) === date(original.date));
      const status = sameDateGoPay.length === 1 && b.length === 1 ? "matched" :
        sameDateGoPay.length > 1 || b.length > 1 ? "ambiguous" : "missing";
      const pair = {date: date(original.date), amount: num(original.amount), status,
        gopayId: status === "matched" ? str(sameDateGoPay[0].id) : null,
        bniId: status === "matched" ? str(b[0].id) : null};
      if (status === "matched") {
        usedGoPay.add(pair.gopayId);
        usedBNI.add(pair.bniId);
      }
      selected.push(pair);
    }

    const confirmedPairs = selected.filter(x => x.status === "matched");
    const confirmedFees = [];
    let feeIssues = 0;
    for (const pair of confirmedPairs) {
      const bankFees = bni.filter(row => date(row.date) === pair.date &&
        row.sign === "-" && num(row.amount) === 1000 &&
        /ewallet\s*top\s*up\s*gopay/i.test(str(row.description)));
      const ledgerFees = cash.filter(row => date(row.tanggal) === pair.date &&
        str(row.currency).toUpperCase() === "IDR" && equal(row.expense_idr, 1000) &&
        /biaya\s*top\s*up\s*gopay/i.test(str(row.item) + " " + str(row.note)) &&
        num(row.pengeluaran) > 0);
      if (bankFees.length === 1 && ledgerFees.length === 1) {
        confirmedFees.push({date: pair.date, amount: 1000, bankId: str(bankFees[0].id),
          ledgerId: str(ledgerFees[0].id)});
      } else feeIssues++;
    }

    const cardSources = sourceRows.filter(row => row.method === "card" && row.sign === "-" &&
      date(row.date).slice(0, 7) === MONTH && validAmount(row.amount));
    const cardPairs = [], cardIssues = [];
    for (const source of cardSources) {
      const wallet = gopay.filter(row => date(row.date) === date(source.date) &&
        row.sign === "-" && equal(row.amount, source.amount) &&
        /card|credit/i.test(str(row.payment_method)));
      const ledger = cash.filter(row => date(row.tanggal) === date(source.date) &&
        str(row.currency).toUpperCase() === "IDR" && equal(row.expense_idr, source.amount) &&
        num(row.pengeluaran) > 0 && /tokopedia\s*card/i.test(str(row.note)));
      if (wallet.length === 1 && ledger.length === 1) {
        cardPairs.push({date:date(source.date),amount:num(source.amount),
          ledgerId:str(ledger[0].id),gopayId:str(wallet[0].id)});
      } else cardIssues.push({date:date(source.date),amount:num(source.amount),
        status:wallet.length > 1 || ledger.length > 1 ? "ambiguous" : "missing"});
    }
    // PDF provides a monthly Coins usage total, not individual spend allocations.
    // An unmatched legacy adjustment must never be deducted from that total again.
    const coinsExceptions = gopay.filter(row => september(row) && row.sign === "-" &&
      num(row.amount) === 0 && validAmount(row.coins) &&
      !sourceRows.some(source => date(source.date) === date(row.date) &&
        source.sign === "-" && num(source.amount) === 0 &&
        num(source.coins) === num(row.coins)))
      .map(row => ({id:str(row.id), date:date(row.date), coins:num(row.coins)}));
    return {
      ready:true, sourceCount:topups.length, pairs:selected,
      matched:confirmedPairs.length, total:confirmedPairs.reduce((s,x)=>s+x.amount,0),
      missing:selected.filter(x=>x.status === "missing").length,
      ambiguous:selected.filter(x=>x.status === "ambiguous").length,
      feesMatched:confirmedFees.length, feeTotal:confirmedFees.reduce((s,x)=>s+x.amount,0),
      feeIssues, feePairs:confirmedFees,
      cardCount:cardSources.length, cardMatched:cardPairs.length,
      cardTotal:cardPairs.reduce((s,x)=>s+x.amount,0), cardPairs, cardIssues,
      coinsExceptions, coinsReportedUsed:validAmount(statement.payload.coins_used) ?
        num(statement.payload.coins_used) : null
    };
  }

  let data = {}, initialized = false;
  const el = id => document.getElementById(id);
  const put = (id, value) => {const target=el(id);if(target)target.textContent=String(value);};
  function render() {
    if (typeof document === "undefined") return;
    const section = el("gopay-cross-account");
    if (!section) return;
    const m = reconcile(data);
    section.classList.toggle("hidden", !m.ready && !m.error);
    if (!m.ready) {
      put("gopay-cross-status",m.error?"Source data unavailable":"No verified September source data");
      return;
    }
    put("gopay-cross-status", m.matched === m.sourceCount && !m.feeIssues &&
      !m.cardIssues.length && !m.ambiguous && !m.missing ?
      "Source checks matched · exceptions separately noted" : "Review required");
    put("gopay-cross-topups",m.matched+"/"+m.sourceCount+" paired · "+rupiah(m.total));
    put("gopay-cross-fees",m.feesMatched+"/"+m.matched+" linked · "+rupiah(m.feeTotal));
    put("gopay-cross-card",m.cardMatched+"/"+m.cardCount+" linked · "+rupiah(m.cardTotal));
    const list=el("gopay-cross-pairs");
    if (list) {
      list.replaceChildren();
      for (const pair of m.pairs) {
        const item=document.createElement("div");item.className="gopay-cross-pair";
        const name=document.createElement("span");
        name.textContent=pair.date+" · BNI → GoPay";
        const value=document.createElement("strong");
        value.textContent=rupiah(pair.amount)+" · "+(pair.status==="matched"?"paired":pair.status);
        item.append(name,value);list.append(item);
      }
    }
    put("gopay-cross-exceptions",
      "Transfer amounts do not create new income or household spending. "+
      "The "+m.feesMatched+" source-linked top-up fees are expenses already recorded in the main ledger. "+
      (m.cardMatched ? m.cardMatched+" card-funded payment(s) already linked to an existing expense; do not import again. " : "")+
      (m.coinsExceptions.length ? m.coinsExceptions.map(x =>
        "Legacy Coins-only adjustment on "+x.date+" ("+x.coins+" Coins) is absent as a separate e-statement transaction; keep it excluded from additional spending calculations.").join(" ") : "")+
      (m.coinsReportedUsed!==null ? "The PDF's "+m.coinsReportedUsed+
        " Coins used is a statement-level total, not a per-purchase reconciliation." : ""));
  }
  function setData(next={}) {
    data={receipts:next.receipts,gopay:next.gopay,bni:next.bni,cash:next.cash,
      loadError:!!next.loadError};
    render();
  }
  function init(){if(initialized)return;initialized=true;render();}
  if(typeof window!=="undefined")window.FinanceGoPayCrossAccount={init,setData,render};
  if(typeof module!=="undefined"&&module.exports)module.exports={reconcile};
})();