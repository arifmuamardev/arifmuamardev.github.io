(() => {
  "use strict";

  // Classification describes the financial meaning of each ledger row.
  // It does not mutate amounts, original currency, bank balances, or payment status.
  const MOVEMENT = "movement", SETTLEMENT = "settlement", LOAN = "loan",
    ADJUSTMENT = "adjustment", UNCERTAIN = "unclassified", SPENDING = "spending",
    INCOME = "income", NEUTRAL = "neutral";
  const amount = x => Number(x) || 0;
  const category = row => String(row?.kategori_normalized || row?.kategori || "").trim();
  const name = row => String(row?.item_normalized || row?.item || "").trim();
  const text = row => [row?.item, row?.item_normalized, row?.note].map(x => String(x || "")).join(" ");
  const posted = (row, asOf) => {
    const d = String(row?.tanggal || "").slice(0,10);
    return /^\d{4}-\d{2}-\d{2}$/.test(d) && d<=asOf;
  };

  function classify(row) {
    const cat=category(row), label=name(row), description=text(row);
    // Payment marker first. Merchant purchases marked 'CC KU' are NOT payments.
    if (cat === "Card Settlement" ||
       /Hokuriku VISA Card Payment|Hokuriku VISA Auto-Debit|CC KU settlement|Tokopedia Card \(Payment:|PAYMENT_KKCB/i.test(description))
      return {kind:SETTLEMENT,confidence:"high",reason:"Card liability settlement, not a second purchase"};
    if (cat === "Account Reconciliation" || /Reconciliation Adjustment|^Balance Adjustment$/i.test(label))
      return {kind:ADJUSTMENT,confidence:"high",reason:"Account/balance bookkeeping adjustment"};
    if (cat === "Loans & Advances" ||
        label === "Loan Repayment (Ryan)" || /^Loan to /i.test(label))
      return {kind:LOAN,confidence:"medium",reason:"Principal loan movement; interest requires separate evidence"};
    if (cat === "Transfers & Movements" || [
      "Self-Transfer (Internal)","Bank Inflow / Auto-Deposit",
      "Remittance to Indonesia","Initial Funds from Home"
    ].includes(label))
      return {kind:MOVEMENT,
        confidence:/Self-Transfer|Bank Inflow|Auto-Deposit|Initial Funds|Hokuriku VISA/i.test(label)?"high":"review",
        reason:"Movement between accounts or payment to recipient; destination may need verification"};
    if (cat === "Others" || cat === "Lain-lain" || !cat)
      return {kind:UNCERTAIN,confidence:"review",reason:"Category or transaction purpose requires review"};
    if (amount(row?.pengeluaran) !== 0)
      return {kind:SPENDING,confidence:"high",reason:"Goods or services, or spending refund/credit"};
    if (amount(row?.pemasukan) > 0)
      return {kind:INCOME,confidence:"medium",reason:"Recorded incoming funds (source/account scope may vary)"};
    return {kind:NEUTRAL,confidence:"high",reason:"No recorded monetary effect"};
  }

  function tally(rows=[], asOf=null) {
    const groups={
      spending:0, income:0, movementOut:0, movementIn:0,
      settlementOut:0, settlementIn:0,
      loanOut:0, loanIn:0,
      adjustmentOut:0, adjustmentIn:0,
      unclassifiedOut:0, unclassifiedIn:0,
      neutralRows:0
    };
    const counts={spending:0,income:0,movement:0,settlement:0,loan:0,adjustment:0,unclassified:0,neutral:0};
    const review=[];
    let rawOut=0,rawIn=0,used=0;
    for (const row of rows) {
      if (asOf && !posted(row,asOf)) continue;
      used++;
      const result=classify(row);
      const out=amount(row.pengeluaran);
      const incoming=amount(row.pemasukan);
      rawOut+=out;rawIn+=incoming;
      counts[result.kind]++;
      if (result.kind===SPENDING) groups.spending+=out;
      else if (result.kind===INCOME) groups.income+=incoming;
      else if (result.kind===NEUTRAL) groups.neutralRows++;
      else {
        const prefix=result.kind==="movement"?"movement":
          result.kind==="settlement"?"settlement":
          result.kind==="loan"?"loan":
          result.kind==="adjustment"?"adjustment":"unclassified";
        groups[prefix+"Out"]+=out;
        groups[prefix+"In"]+=incoming;
      }
      if(result.confidence==="review" || result.kind===UNCERTAIN)
        review.push({id:Number(row.id),tanggal:String(row.tanggal||"").slice(0,10),
          title:String(row.item||row.item_normalized||"Unknown"),kind:result.kind,
          amount:out,reason:result.reason});
    }
    const assignedOut=groups.spending+groups.movementOut+groups.settlementOut+
      groups.loanOut+groups.adjustmentOut+groups.unclassifiedOut;
    const assignedIn=groups.income+groups.movementIn+groups.settlementIn+
      groups.loanIn+groups.adjustmentIn+groups.unclassifiedIn;
    const rounded=n=>Math.round(n*100)/100;
    return {
      rawOut:rounded(rawOut),rawIn:rounded(rawIn),records:used,
      ...Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,rounded(v)])),
      counts, review:review.sort((a,b)=>b.tanggal.localeCompare(a.tanggal)||b.id-a.id),
      outflowGap:rounded(rawOut-assignedOut),inflowGap:rounded(rawIn-assignedIn)
    };
  }

  const api={classify,tally};
  if(typeof window!=="undefined")window.FinanceFlowClassifier=api;
  if(typeof module!=="undefined" && module.exports)module.exports=api;
})();
