(() => {
  "use strict";

  // Read-only quality checks. These are review candidates, not accounting verdicts.
  let cash = [];
  let asOfOverride = null;

  const value = x => Number(x) || 0;
  const cents = x => Math.round(value(x) * 100);
  const dateOf = x => String(x?.tanggal || "").slice(0, 10);
  const currencyOf = x => String(x?.currency || "").toUpperCase();
  const labelOf = x => String(x?.item_normalized || x?.item || "Transaction");
  const textOf = x => String(x ?? "").trim();
  const monthOf = x => dateOf(x).slice(0, 7);
  const money = (x, digits = 2) => "¥" + new Intl.NumberFormat("ja-JP", {
    maximumFractionDigits: digits
  }).format(Math.abs(value(x)));

  function todayTokyo() {
    if (asOfOverride) return asOfOverride;
    const pieces = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(new Date()).filter(x => x.type !== "literal").map(x => [x.type, x.value]));
    return pieces.year + "-" + pieces.month + "-" + pieces.day;
  }

  function dateValid(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    const parsed = new Date(date + "T00:00:00Z");
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
  }

  function compareRow(a, b) {
    return dateOf(a).localeCompare(dateOf(b)) || Number(a.id || 0) - Number(b.id || 0);
  }

  function median(values) {
    const v = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!v.length) return null;
    const mid = Math.floor(v.length / 2);
    return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  }

  function exactKey(row) {
    // Keep all business fields affecting identity, including the recorded balance.
    const n = key => row[key] === null || row[key] === undefined ? null : cents(row[key]);
    return JSON.stringify([
      dateOf(row), currencyOf(row),
      textOf(row.item), textOf(row.item_normalized),
      textOf(row.kategori), textOf(row.kategori_normalized),
      textOf(row.tempat), textOf(row.payment_type), textOf(row.note),
      n("pemasukan"), n("pengeluaran"), n("saldo"), n("expense_idr")
    ]);
  }

  function findDuplicates(rows) {
    const groups = new Map();
    for (const row of rows) {
      const key = exactKey(row);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    const candidates = [...groups.values()].filter(group => group.length > 1);
    return {
      groups: candidates.length,
      extraRows: candidates.reduce((n, group) => n + group.length - 1, 0),
      candidates: candidates.map(group => ({
        date: dateOf(group[0]),
        label: labelOf(group[0]),
        count: group.length,
        ids: group.map(x => Number(x.id)).filter(Number.isFinite),
        currency: currencyOf(group[0])
      })).sort((a, b) => b.date.localeCompare(a.date))
    };
  }

  function balanceCheck(rows) {
    // Balance exists on JPY rows; IDR-origin rows have no balance checkpoints.
    // Running balances can be account-scoped, so discrepancies only invite review.
    const ordered = rows.filter(row => currencyOf(row) === "JPY")
      .sort(compareRow);
    let cumulative = 0;
    let previous = null;
    let compared = 0;
    const candidates = [];
    let checkpoints = 0;
    for (const row of ordered) {
      cumulative += cents(row.pemasukan) - cents(row.pengeluaran);
      if (row.saldo === null || row.saldo === undefined || !Number.isFinite(Number(row.saldo))) continue;
      checkpoints++;
      const checkpoint = { balance: cents(row.saldo), cumulative };
      if (previous) {
        compared++;
        const gapCents = checkpoint.balance - previous.balance -
          (checkpoint.cumulative - previous.cumulative);
        if (Math.abs(gapCents) > 2) {
          candidates.push({
            id: Number(row.id), date: dateOf(row), label: labelOf(row),
            gap: gapCents / 100
          });
        }
      }
      previous = checkpoint;
    }
    candidates.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
    return { checkpoints, compared, candidates, mismatches: candidates.length };
  }

  function fxCheck(rows) {
    const originIdr = rows.filter(row => currencyOf(row) === "IDR");
    const pairs = originIdr.filter(row =>
      value(row.pengeluaran) > 0 && row.expense_idr !== null &&
      row.expense_idr !== undefined && value(row.expense_idr) > 0);
    // Small JPY equivalents amplify rounding noise. Infer historic reference
    // from meaningful stored pairs, rather than today's market exchange rate.
    const rates = pairs.filter(row => value(row.pengeluaran) >= 10)
      .map(row => value(row.expense_idr) / value(row.pengeluaran));
    const benchmark = rates.length >= 3 ? median(rates) : null;
    const candidates = [];
    if (benchmark !== null) {
      for (const row of pairs) {
        const expected = value(row.pengeluaran) * benchmark;
        const gapIdr = value(row.expense_idr) - expected;
        const allowed = Math.max(1, Math.abs(value(row.expense_idr)) * 0.02);
        if (Math.abs(gapIdr) > allowed) {
          candidates.push({
            id: Number(row.id), date: dateOf(row), label: labelOf(row),
            gapIdr: Math.round(gapIdr * 100) / 100
          });
        }
      }
    }
    candidates.sort((a, b) => Math.abs(b.gapIdr) - Math.abs(a.gapIdr));
    return { pairs: pairs.length, benchmark, candidates, exceptions: candidates.length };
  }

  function check(rows, asOf) {
    const valid = rows.filter(row => dateValid(dateOf(row)));
    const posted = valid.filter(row => dateOf(row) <= asOf);
    const future = valid.filter(row => dateOf(row) > asOf);
    const active = [...posted].sort(compareRow);
    const lastPosted = active.length ? dateOf(active.at(-1)) : null;
    const daysSince = lastPosted
      ? Math.max(0, Math.round((Date.parse(asOf + "T00:00:00Z") -
        Date.parse(lastPosted + "T00:00:00Z")) / 86400000))
      : null;
    return {
      total: rows.length, posted: posted.length, scheduled: future.length,
      invalidDates: rows.length - valid.length,
      byCurrency: {
        JPY: valid.filter(x => currencyOf(x) === "JPY").length,
        IDR: valid.filter(x => currencyOf(x) === "IDR").length,
        other: valid.filter(x => !["JPY", "IDR"].includes(currencyOf(x))).length
      },
      lastPosted, daysSince,
      categoryReview: rows.filter(row => (row.kategori_normalized || row.kategori) === "Others")
        .map(row=>({id:Number(row.id), date:dateOf(row), label:String(row.item||row.item_normalized||"Unknown item"),
          currency:currencyOf(row), amount:value(row.pengeluaran)}))
        .sort((a,b)=>b.date.localeCompare(a.date)||b.id-a.id),
      duplicate: findDuplicates(valid),
      balance: balanceCheck(posted),
      fx: fxCheck(valid)
    };
  }

  function put(id, content) {
    const node = document.getElementById(id);
    if (node) node.textContent = String(content);
  }

  function fillList(id, rows, group) {
    const container = document.getElementById(id);
    if (!container) return;
    container.replaceChildren();
    if (!rows.length) {
      const empty = document.createElement("p");
      empty.className = "integrity-empty";
      empty.textContent = "No review candidates detected by this check.";
      container.append(empty);
      return;
    }
    for (const row of rows.slice(0, 12)) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "integrity-entry";
      const transactionId = group === "duplicate" ? row.ids[0] : row.id;
      button.dataset.integrityTransaction = String(transactionId);
      const description = document.createElement("span");
      const heading = document.createElement("strong");
      heading.textContent = row.label;
      const context = document.createElement("small");
      context.textContent = row.date + (group === "duplicate"
        ? " · " + row.count + " near-identical entries · " + row.currency
        : group === "balance" ? " · JPY balance checkpoint" : " · IDR conversion pair");
      description.append(heading, context);
      const indicator = document.createElement("span");
      indicator.className = "integrity-entry-value";
      indicator.textContent = group === "duplicate"
        ? row.ids.join(", ")
        : group === "balance" ? (row.gap < 0 ? "−" : "+") + money(row.gap)
        : (row.gapIdr < 0 ? "−" : "+") + "Rp" +
          new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(Math.abs(row.gapIdr));
      button.append(description, indicator);
      container.append(button);
    }
    if (rows.length > 12) {
      const more = document.createElement("p");
      more.className = "integrity-empty";
      more.textContent = "Showing 12 of " + rows.length + " review candidates.";
      container.append(more);
    }
  }

  function render() {
    const m = check(cash, todayTokyo());
    put("integrity-total", m.total.toLocaleString("ja-JP"));
    put("integrity-split", m.byCurrency.JPY + " JPY · " + m.byCurrency.IDR +
      " IDR origin" + (m.byCurrency.other ? " · " + m.byCurrency.other + " other" : ""));
    put("integrity-others",m.categoryReview.length);
    put("integrity-others-meta",(m.total ? (100*m.categoryReview.length/m.total).toFixed(2) : "0.00")+
      "% of ledger · manual category review");
    const reviewList=document.getElementById("integrity-category-review-list");
    if(reviewList) {
      reviewList.replaceChildren();
      if(!m.categoryReview.length) {
        const empty=document.createElement("p");
        empty.className="integrity-empty";empty.textContent="No remaining Others entries.";
        reviewList.append(empty);
      }
      for(const row of m.categoryReview) {
        const button=document.createElement("button");
        button.type="button";button.className="integrity-entry";
        button.dataset.integrityTransaction=String(row.id);
        const label=document.createElement("span");
        const name=document.createElement("strong");name.textContent=row.label;
        const meta=document.createElement("small");meta.textContent=row.date+" · "+row.currency;
        label.append(name,meta);
        const amount=document.createElement("span");
        amount.className="integrity-entry-value";
        amount.textContent="¥"+new Intl.NumberFormat("ja-JP",{maximumFractionDigits:2}).format(row.amount);
        button.append(label,amount);
        reviewList.append(button);
      }
    }
    put("integrity-duplicates", m.duplicate.extraRows);
    put("integrity-duplicates-meta", m.duplicate.groups + " candidate groups; no rows changed");
    put("integrity-balance", m.balance.mismatches);
    put("integrity-balance-meta", m.balance.compared + " JPY checkpoint pairs compared");
    put("integrity-fx", m.fx.benchmark === null ? "—" : m.fx.exceptions);
    put("integrity-fx-meta", m.fx.benchmark === null
      ? "Insufficient IDR conversion pairs"
      : m.fx.pairs + " pairs · reference ≈ Rp" +
        new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(m.fx.benchmark) + "/¥");
    put("integrity-freshness", m.lastPosted || "No posted transactions");
    put("integrity-freshness-meta", m.daysSince === null ? "No posted date"
      : m.daysSince + " days since latest posted transaction · " + m.scheduled + " future-dated");
    put("integrity-invalid", m.invalidDates + m.byCurrency.other);
    put("integrity-invalid-meta", m.invalidDates + " invalid dates · " + m.byCurrency.other + " unknown currencies");
    fillList("integrity-duplicate-list", m.duplicate.candidates, "duplicate");
    fillList("integrity-balance-list", m.balance.candidates, "balance");
    fillList("integrity-fx-list", m.fx.candidates, "fx");
    const note = document.getElementById("integrity-quality-note");
    if (note) {
      const warnings = [];
      if (m.daysSince === null || m.daysSince > 7)
        warnings.push("Ledger freshness is limited; recent unrecorded spending cannot be detected.");
      if (m.balance.mismatches)
        warnings.push("Balance differences are investigative signals, not proof of incorrect transactions or balances.");
      if (m.duplicate.extraRows)
        warnings.push("Matching transaction contents can represent valid repeated entries. Inspect before changing anything.");
      note.textContent = warnings.join(" ");
      note.classList.toggle("hidden", warnings.length === 0);
    }
  }

  function setData(next = {}) {
    cash = Array.isArray(next.cash) ? next.cash : [];
    render();
  }

  function init() {
    document.getElementById("view-integrity")?.addEventListener("click", event => {
      const target = event.target.closest("[data-integrity-transaction]");
      if (!target) return;
      const id = Number(target.dataset.integrityTransaction);
      if (Number.isFinite(id)) {
        window.dispatchEvent(new CustomEvent("budget:open-transaction", { detail: { id } }));
      }
    });
    render();
  }

  if (typeof window !== "undefined")
    window.FinanceIntegrity = { init, setData, render };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      snapshotForTest({ rows = [], asOf = "2026-10-14" } = {}) {
        return check(rows, asOf);
      }
    };
  }
})();
