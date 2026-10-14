(() => {
  "use strict";

  // The authenticated Neon table is the source of truth for imported documents.
  // It is deliberately separate from cash_transactions to prevent duplicate spend.
  let input = { evidence: [], cash: [], loadError: false };
  let filter = "all";

  const num = x => Number(x) || 0;
  const date = x => String(x || "").slice(0, 10);
  const yen = x => "¥" + new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 }).format(num(x));
  const note = row => String(row?.note || "").toUpperCase();
  const moneyEq = (a, b) => Math.abs(num(a) - num(b)) <= 0.01;

  function matchLines(statement, cash, taken) {
    const lines = Array.isArray(statement?.payload?.lines) ? statement.payload.lines : [];
    const ledger = Array.isArray(cash) ? cash : [];
    const results = lines.map(line => ({ ...line, status: "unmatched", ledgerId: null }));

    // Exact date / amount candidates are considered before shifted posting dates.
    for (const result of results) {
      const options = ledger.filter(row => !taken.has(String(row.id)) &&
        date(row.tanggal) === date(result.transaction_date) &&
        moneyEq(row.pengeluaran, result.amount_jpy) && num(row.pengeluaran) > 0);
      options.sort((a, b) =>
        (note(a).includes("CC KU") ? 0 : 1) - (note(b).includes("CC KU") ? 0 : 1) ||
        Number(a.id || 0) - Number(b.id || 0));
      if (!options.length) continue;
      const choice = options[0];
      taken.add(String(choice.id));
      result.ledgerId = Number(choice.id);
      result.status = note(choice).includes("CC KU") ? "cc_candidate" : "amount_candidate";
    }

    // If the bank posted the same merchant one day later, retain a separate
    // review status. Require a credit-card marker AND meaningful merchant match.
    const normalize = x => String(x || "").normalize("NFKC").toUpperCase()
      .replace(/[^A-Z0-9\u3040-\u30FF\u3400-\u9FFF]/g, "");
    const dayGap = (a, b) => {
      const x = Date.parse(date(a) + "T00:00:00Z");
      const y = Date.parse(date(b) + "T00:00:00Z");
      return Number.isFinite(x) && Number.isFinite(y) ? Math.abs(x - y) / 86400000 : Infinity;
    };
    for (const result of results.filter(x => x.status === "unmatched")) {
      const merchant = normalize(result.merchant);
      if (merchant.length < 4) continue;
      const options = ledger.filter(row => !taken.has(String(row.id)) &&
        note(row).includes("CC KU") &&
        num(row.pengeluaran) > 0 && moneyEq(row.pengeluaran, result.amount_jpy) &&
        dayGap(row.tanggal, result.transaction_date) === 1 &&
        [row.tempat, row.item, row.item_normalized].some(label => {
          const merchantInLedger = normalize(label);
          return merchantInLedger.length >= 4 &&
            (merchantInLedger.includes(merchant) || merchant.includes(merchantInLedger));
        }));
      options.sort((a, b) => Number(a.id || 0) - Number(b.id || 0));
      if (!options.length) continue;
      const choice = options[0];
      taken.add(String(choice.id));
      result.ledgerId = Number(choice.id);
      result.status = "date_shift_candidate";
    }
    return results;
  }

  function calculate(evidence = [], cash = [], loadError = false) {
    if (loadError) return { available: false, reason: "Unable to load card evidence." };
    const lookup = new Map((Array.isArray(evidence) ? evidence : [])
      .map(row => [row.evidence_key, row]));
    const november = lookup.get("statement_2026-11-10");
    const october = lookup.get("statement_2026-10-13");
    const credit = lookup.get("credit_snapshot_2026-10-14");
    const octPayment = lookup.get("bank_payment_2026-10-13");
    const sepPayment = lookup.get("bank_payment_2026-09-10");
    const sepBank = lookup.get("bank_balance_2026-09-30");
    const octBank = lookup.get("bank_balance_2026-10-14");
    if (!november || !october || !credit || !octPayment || !sepBank || !octBank)
      return { available: false, reason: "Evidence import is incomplete. Do not assume a zero balance." };
    const used = new Set();
    const lines = matchLines(november, cash, used);
    const octLines = matchLines(october, cash, used);
    const count = status => lines.filter(x => x.status === status).length;
    const sum = status => lines.filter(x => x.status === status)
      .reduce((n, x) => n + num(x.amount_jpy), 0);
    const total = lines.reduce((n, x) => n + num(x.amount_jpy), 0);
    const octSum = octLines.reduce((n, x) => n + num(x.amount_jpy), 0);
    const bankDelta = num(sepBank.payload.balance_jpy) - num(octPayment.payload.amount_jpy);
    const novTotal = num(november.payload.total_jpy);
    const creditData = credit.payload;
    return {
      available: true, november: november.payload, october: october.payload,
      credit: creditData, lines, octLines,
      asOf: date(creditData.as_of),
      counts: {
        total: lines.length, ccCandidates: count("cc_candidate"),
        shiftedCandidates: count("date_shift_candidate"),
        amountCandidates: count("amount_candidate"), unmatched: count("unmatched")
      },
      totals: {
        pdf: novTotal, sum: total,
        ccCandidates: sum("cc_candidate"), shiftedCandidates: sum("date_shift_candidate"),
        amountCandidates: sum("amount_candidate"),
        unmatched: sum("unmatched")
      },
      checks: {
        novDocument: moneyEq(total, novTotal),
        octoberDocument: moneyEq(octSum, october.payload.total_jpy),
        creditLimit: moneyEq(
          num(creditData.credit_limit_jpy) - num(creditData.outstanding_jpy),
          creditData.available_jpy),
        octoberPaid: !!octPayment.payload.verified_from_bank &&
          moneyEq(octPayment.payload.amount_jpy, october.payload.total_jpy) &&
          date(octPayment.payload.on) === date(october.payload.due_date),
        bankBalanceMovement: moneyEq(bankDelta, octBank.payload.balance_jpy)
      },
      octPayment: octPayment.payload, sepPayment: sepPayment?.payload || null,
      lastBank: octBank.payload, priorBank: sepBank.payload,
      outstandingVsBill: num(creditData.outstanding_jpy) - novTotal,
      usedIds: [...used]
    };
  }

  function make(tag, cls, value) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (value !== undefined) n.textContent = String(value);
    return n;
  }
  function put(id, val) {
    const n = document.getElementById(id);
    if (n) n.textContent = String(val);
  }
  function statusName(kind) {
    return kind === "cc_candidate" ? "CC KU candidate" :
      kind === "date_shift_candidate" ? "1-day merchant match" :
      kind === "amount_candidate" ? "Date / amount only" : "Not found in ledger";
  }

  function renderLines(rows) {
    const parent = document.getElementById("visa-proof-rows");
    if (!parent) return;
    parent.replaceChildren();
    const selected = rows.filter(row => filter === "all" ||
      (filter === "matched" && row.status !== "unmatched") ||
      (filter === "missing" && row.status === "unmatched"));
    for (const line of selected) {
      const row = make("div", "visa-proof-row");
      const left = make("div", "visa-proof-label");
      left.append(make("strong", "", line.merchant));
      left.append(make("small", "", line.transaction_date + " · statement line " + line.line_no));
      row.append(left);
      const amount = make("strong", "visa-proof-amount", yen(line.amount_jpy));
      row.append(amount);
      const state = make("span", "visa-proof-status visa-proof-" + line.status, statusName(line.status));
      row.append(state);
      if (line.ledgerId !== null) {
        const go = make("button", "visa-proof-detail", "View ledger #" + line.ledgerId);
        go.type = "button";
        go.dataset.visaLedgerId = String(line.ledgerId);
        row.append(go);
      }
      parent.append(row);
    }
    if (!selected.length) parent.append(make("p", "visa-proof-muted", "No entries in this filter."));
  }

  function render() {
    const m = calculate(input.evidence, input.cash, input.loadError);
    const empty = document.getElementById("visa-evidence-unavailable");
    const content = document.getElementById("visa-evidence-content");
    if (!m.available) {
      if (empty) { empty.classList.remove("hidden"); empty.textContent = m.reason; }
      if (content) content.classList.add("hidden");
      return;
    }
    if (empty) empty.classList.add("hidden");
    if (content) content.classList.remove("hidden");
    put("visa-credit-limit", yen(m.credit.credit_limit_jpy));
    put("visa-used", yen(m.credit.outstanding_jpy));
    put("visa-available", yen(m.credit.available_jpy));
    put("visa-bank-balance", yen(m.lastBank.balance_jpy));
    put("visa-bank-previous", yen(m.priorBank.balance_jpy));
    put("visa-bank-payment", yen(m.octPayment.amount_jpy));
    put("visa-bank-payment-date", m.octPayment.on);
    put("visa-september-payment", m.sepPayment ? yen(m.sepPayment.amount_jpy) : "Not supplied");
    put("visa-nov-bill", yen(m.totals.pdf));
    put("visa-oct-bill", yen(m.october.total_jpy));
    put("visa-nov-count", m.counts.total);
    put("visa-candidate-count", m.counts.ccCandidates);
    put("visa-candidate-sum", yen(m.totals.ccCandidates));
    put("visa-shift-candidate-count", m.counts.shiftedCandidates);
    put("visa-shift-candidate-sum", yen(m.totals.shiftedCandidates));
    put("visa-amount-candidate-count", m.counts.amountCandidates);
    put("visa-amount-candidate-sum", yen(m.totals.amountCandidates));
    put("visa-unmatched-count", m.counts.unmatched);
    put("visa-unmatched-sum", yen(m.totals.unmatched));
    put("visa-credit-diff", yen(m.outstandingVsBill));
    put("visa-credit-date", m.asOf);
    const checks = [
      ["November source total", m.checks.novDocument],
      ["October source total", m.checks.octoberDocument],
      ["Credit limit equation", m.checks.creditLimit],
      ["October bill debited from bank", m.checks.octoberPaid],
      ["Bank balance movement", m.checks.bankBalanceMovement]
    ];
    const checkParent = document.getElementById("visa-proof-checks");
    if (checkParent) {
      checkParent.replaceChildren();
      for (const [name, valid] of checks) {
        const row = make("div", "visa-proof-check");
        row.append(make("span", "", name), make("strong", valid ? "Matched" : "Needs review"));
        checkParent.append(row);
      }
    }
    const warn = document.getElementById("visa-matching-warning");
    if (warn) warn.textContent = m.counts.unmatched + " statement line(s) have no supported ledger match. " +
      "Date-and-amount matches are candidates, not merchant-verified matches. " +
      "The " + yen(m.outstandingVsBill) + " difference between card outstanding and the provisional bill is not explained by the supplied sources; do not create a balancing transaction.";
    renderLines(m.lines);
  }

  function setData(next) {
    input = {
      cash: Array.isArray(next?.cash) ? next.cash : [],
      evidence: Array.isArray(next?.evidence) ? next.evidence : [],
      loadError: !!next?.loadError
    };
    render();
  }
  function init() {
    const view = document.getElementById("view-visa-review");
    view?.addEventListener("click", event => {
      const click = event.target.closest("[data-visa-ledger-id]");
      if (click) {
        const id = Number(click.dataset.visaLedgerId);
        if (Number.isFinite(id))
          window.dispatchEvent(new CustomEvent("budget:open-transaction", { detail: { id } }));
        return;
      }
      const button = event.target.closest("[data-visa-filter]");
      if (button) {
        filter = button.dataset.visaFilter;
        for (const control of view.querySelectorAll("[data-visa-filter]"))
          control.classList.toggle("active", control === button);
        render();
      }
    });
    render();
  }
  if (typeof window !== "undefined") window.FinanceVisaReview = { init, setData, render };
  if (typeof module !== "undefined" && module.exports) module.exports = { snapshotForTest: calculate };
})();