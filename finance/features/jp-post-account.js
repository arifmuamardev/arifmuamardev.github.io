(() => {
  "use strict";

  // This module reads one separate bank's source statement.
  // It never adjusts balances, treats bank movements as purchases,
  // or uses the general JPY cash ledger as an account balance.
  const RENT_KEY = "JPPOST-20260928-LIFECARD-35970";
  let source = { rows: [], cash: [], loadError: false };
  let initialized = false;

  function str(v) { return String(v ?? "").trim(); }
  function number(v) { return Number(v); }
  function date(v) { return str(v).slice(0, 10); }
  function validDate(v) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    const t = new Date(v + "T00:00:00Z");
    return Number.isFinite(t.getTime()) && t.toISOString().slice(0, 10) === v;
  }
  function tokyoToday() {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(new Date()).filter(x => x.type !== "literal")
      .map(x => [x.type, x.value]));
    return parts.year + "-" + parts.month + "-" + parts.day;
  }
  function yen(v) {
    return "¥" + new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 })
      .format(Math.abs(number(v) || 0));
  }
  function signed(v, sign) { return (sign === "+" ? "+" : "−") + yen(v); }
  function compare(a, b) {
    return date(a.date).localeCompare(date(b.date)) || number(a.id) - number(b.id);
  }
  function meaningfulBalance(v) {
    return v !== null && v !== undefined && v !== "" && Number.isFinite(number(v));
  }
  function statementForTest(rows = [], cash = [], opts = {}) {
    const asOf = opts.asOf || tokyoToday();
    if (opts.loadError) return { available: false, error: true, rows: [],
      balance: null, balanceDate: null, count: 0, gaps: [] };
    const records = Array.isArray(rows) ? rows : [];
    const ledgers = Array.isArray(cash) ? cash : [];
    const seen = new Set();
    const duplicates = [];
    const valid = [];
    let invalidOrFuture = 0;
    for (const record of records) {
      const d = date(record?.date);
      const key = str(record?.evidence_key);
      const amt = number(record?.amount_jpy);
      if (!validDate(d) || d > asOf ||
          (record.sign !== "+" && record.sign !== "-") ||
          !Number.isFinite(amt) || amt < 0 || !key) {
        invalidOrFuture++;
        continue;
      }
      if (seen.has(key)) {
        duplicates.push(key);
        continue;
      }
      seen.add(key);
      valid.push(record);
    }
    valid.sort(compare);
    const mapped = valid.map(record => {
      const key = str(record.evidence_key), d = date(record.date);
      const amt = number(record.amount_jpy);
      const matches = ledgers.filter(c => {
        if (date(c.tanggal) !== d || str(c.currency).toUpperCase() !== "JPY" ||
            !str(c.note).includes("SRC=" + key)) return false;
        const n = number(record.sign === "+" ? c.pemasukan : c.pengeluaran);
        const other = number(record.sign === "+" ? c.pengeluaran : c.pemasukan);
        return Number.isFinite(n) && Math.abs(n - amt) < 0.01 &&
          Number.isFinite(other) && Math.abs(other) < 0.01;
      });
      return {
        ...record, amount_jpy: amt, date: d, linkedLedgerId: matches.length === 1
          ? Number(matches[0].id) : null,
        duplicateLedgerMatches: matches.length > 1
      };
    });
    let previous = null, compared = 0, missingBalances = 0;
    const gaps = [];
    for (const row of mapped) {
      if (!meaningfulBalance(row.balance_jpy)) {
        missingBalances++;
        previous = null; // never bridge across an absent checkpoint
        continue;
      }
      if (previous) {
        compared++;
        const expected = number(previous.balance_jpy) +
          (row.sign === "+" ? row.amount_jpy : -row.amount_jpy);
        const gap = number(row.balance_jpy) - expected;
        if (Math.abs(gap) > 0.01) gaps.push({
          evidence_key: row.evidence_key, date: row.date, delta: gap
        });
      }
      previous = row;
    }
    const latest = [...mapped].reverse().find(r => meaningfulBalance(r.balance_jpy));
    const rentRows = mapped.filter(row => row.evidence_key === RENT_KEY &&
      row.sign === "-" && row.date === "2026-09-28" && row.amount_jpy === 35970);
    const rent = rentRows.length === 1 ? {
      bankPaid: true, amount: 35970, date: rentRows[0].date,
      ledgerLinked: rentRows[0].linkedLedgerId != null,
      ledgerId: rentRows[0].linkedLedgerId
    } : { bankPaid: false, amount: null, ledgerLinked: false, ledgerId: null };
    return {
      available: mapped.length > 0,
      error: false, asOf,
      rows: mapped, count: mapped.length,
      firstDate: mapped[0]?.date || null, latestDate: mapped.at(-1)?.date || null,
      balance: latest ? number(latest.balance_jpy) : null,
      balanceDate: latest?.date || null,
      compared, gaps, missingBalances, duplicates,
      invalidOrFuture, rent,
      linkedLedgerCount: mapped.filter(r => r.linkedLedgerId != null).length
    };
  }
  function selectRows(rows, month, type, query) {
    const q = str(query).toLocaleLowerCase();
    return rows.filter(row =>
      (month === "all" || row.date.slice(0, 7) === month) &&
      (type === "all" ||
        (type === "in" && row.sign === "+") ||
        (type === "out" && row.sign === "-") ||
        (type === "rent" && /Life Card/i.test(str(row.type)))) &&
      (!q || (str(row.description) + " " + str(row.type) + " " + row.date)
        .toLocaleLowerCase().includes(q))
    );
  }
  function byId(id) { return document.getElementById(id); }
  function put(id, value) { const el = byId(id); if (el) el.textContent = value; }
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }
  function populateMonths(rows) {
    const select = byId("jp-post-month");
    if (!select) return;
    const current = select.value || "all";
    const months = [...new Set(rows.map(r => r.date.slice(0, 7)))].sort().reverse();
    select.replaceChildren(element("option", "", "All months"));
    select.firstChild.value = "all";
    for (const month of months) {
      const option = element("option", "", month);
      option.value = month;
      select.append(option);
    }
    select.value = months.includes(current) ? current : "all";
  }
  function renderRows(model) {
    const list = byId("jp-post-rows");
    if (!list) return;
    list.replaceChildren();
    const month = byId("jp-post-month")?.value || "all";
    const type = byId("jp-post-type")?.value || "all";
    const search = byId("jp-post-search")?.value || "";
    const matches = selectRows(model.rows, month, type, search).slice().reverse();
    byId("jp-post-empty")?.classList.toggle("hidden", matches.length !== 0);
    for (const row of matches) {
      const card = element("article", "jp-post-transaction");
      if (row.evidence_key === RENT_KEY) card.classList.add("jp-post-is-rent");
      const primary = element("div", "jp-post-transaction-primary");
      primary.append(element("span", "jp-post-date", row.date),
        element("strong", "jp-post-description", str(row.description) || str(row.type)),
        element("small", "jp-post-type-label", str(row.type)));
      const amounts = element("div", "jp-post-transaction-amounts");
      amounts.append(element("strong", row.sign === "+" ? "jp-post-positive" : "jp-post-negative",
        signed(row.amount_jpy, row.sign)));
      amounts.append(element("small", "", "After: " +
        (meaningfulBalance(row.balance_jpy) ? yen(row.balance_jpy) : "No balance on source")));
      const foot = element("div", "jp-post-transaction-foot");
      foot.append(element("span", "", row.linkedLedgerId
        ? "Source-linked ledger record" : "Bank statement entry · ledger link not verified"));
      if (row.linkedLedgerId) {
        const link = element("button", "jp-post-open-ledger", "Open ledger record");
        link.type = "button";
        link.dataset.jpLedger = String(row.linkedLedgerId);
        foot.append(link);
      }
      card.append(primary, amounts, foot);
      list.append(card);
    }
  }
  function render() {
    if (typeof document === "undefined") return;
    const model = statementForTest(source.rows, source.cash, {
      loadError: source.loadError
    });
    const loadError = byId("jp-post-load-error"), panel = byId("jp-post-data");
    if (!model.available) {
      panel?.classList.add("hidden");
      if (loadError) {
        loadError.classList.remove("hidden");
        loadError.textContent = model.error
          ? "The authenticated Japan Post Bank statement could not be loaded. Other accounts are unaffected."
          : "No verified Japan Post Bank statement records available yet.";
      }
      put("jp-post-asof", "No verified account snapshot");
      return;
    }
    loadError?.classList.add("hidden");
    panel?.classList.remove("hidden");
    put("jp-post-asof", "Statement as of " + model.balanceDate +
      " · not a live bank balance");
    put("jp-post-balance", model.balance === null ? "Not available" : yen(model.balance));
    put("jp-post-balance-caption", "Last bank checkpoint " + model.balanceDate);
    put("jp-post-count", String(model.count));
    const warnings = model.gaps.length + model.duplicates.length;
    put("jp-post-checks", model.compared + " checked");
    put("jp-post-checks-detail", warnings === 0
      ? "No gaps or duplicate source keys detected"
      : warnings + " gaps or duplicate source keys need review");
    put("jp-post-rent", model.rent.bankPaid ? "Paid · " + yen(model.rent.amount) : "Not verified");
    put("jp-post-rent-note", model.rent.bankPaid
      ? "Life Card debit " + model.rent.date + (model.rent.ledgerLinked ? " · ledger linked" : " · ledger link missing")
      : "October 2026 direct debit not found");
    put("jp-post-coverage", "Imported bank source coverage: " + model.firstDate + " to " +
      model.latestDate + ". " + model.linkedLedgerCount + "/" + model.count +
      " source records explicitly linked to the main ledger. " +
      (model.missingBalances ? model.missingBalances + " missing balances. " : "") +
      (model.gaps.length ? model.gaps.length + " checkpoint gaps. " : "") +
      (model.duplicates.length ? model.duplicates.length + " repeated source keys. " : "") +
      (model.invalidOrFuture ? model.invalidOrFuture + " future/invalid records excluded. " : "") +
      "Unshown transactions cannot be ruled out by these screenshots.");
    populateMonths(model.rows);
    renderRows(model);
  }
  function setData(data = {}) {
    source = {
      rows: Array.isArray(data.rows) ? data.rows : [],
      cash: Array.isArray(data.cash) ? data.cash : [],
      loadError: !!data.loadError
    };
    render();
  }
  function init() {
    if (typeof document === "undefined" || initialized) return;
    initialized = true;
    const view = byId("view-jp-post-account");
    for (const id of ["jp-post-month","jp-post-type","jp-post-search"]) {
      const input = byId(id);
      input?.addEventListener(id === "jp-post-search" ? "input" : "change", () => {
        renderRows(statementForTest(source.rows, source.cash, { loadError: source.loadError }));
      });
    }
    view?.addEventListener("click", event => {
      const link = event.target.closest("[data-jp-ledger]");
      if (!link) return;
      const id = Number(link.dataset.jpLedger);
      if (Number.isSafeInteger(id) && id > 0)
        window.dispatchEvent(new CustomEvent("budget:open-transaction", { detail: { id } }));
    });
    render();
  }
  if (typeof window !== "undefined")
    window.FinanceJPPost = { init, setData, render };
  if (typeof module !== "undefined" && module.exports)
    module.exports = { statementForTest, selectRows };
})();