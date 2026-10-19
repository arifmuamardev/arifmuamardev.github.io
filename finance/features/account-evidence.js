(() => {
  "use strict";

  // All figures here are observation snapshots, not reconciled net worth.
  // Japan cash/bank balances are not present as per-account statements.
  const ACCOUNT_SOURCES = [
    { key: "bni", name: "BNI", target: "view-bni-account" },
    { key: "muamalat", name: "Muamalat", target: "view-muamalat-account" },
    { key: "gopay", name: "GoPay", target: "view-gopay-account" }
  ];
  const MOVEMENT_ITEMS = new Set([
    "Self-Transfer (Internal)",
    "Bank Inflow / Auto-Deposit",
    "Remittance to Indonesia",
    "Balance Reconciliation",
    "Transfer & ATM Fees"
  ]);
  let datasets = { cash: [], withdrawals: [], bni: [], muamalat: [], gopay: [], jpPost: [] };
  let clockOverride = null;

  function str(x) { return String(x ?? "").trim(); }
  function num(x) { return Number(x) || 0; }
  function cents(x) { return Math.round(num(x) * 100); }
  function txDate(row, field = "date") { return str(row?.[field]).slice(0, 10); }
  function label(row) { return str(row?.item_normalized || row?.item || "Transaction"); }
  function format(value, digits = 2) {
    return new Intl.NumberFormat("ja-JP", { maximumFractionDigits: digits })
      .format(Math.abs(num(value)));
  }
  function signed(value, prefix = "¥", digits = 2) {
    return (value < 0 ? "−" : "+") + prefix + format(value, digits);
  }
  function todayTokyo() {
    if (clockOverride) return clockOverride;
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(new Date()).filter(x => x.type !== "literal").map(x => [x.type, x.value]));
    return parts.year + "-" + parts.month + "-" + parts.day;
  }
  function validDate(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    const dt = new Date(date + "T00:00:00Z");
    return Number.isFinite(dt.getTime()) && dt.toISOString().slice(0, 10) === date;
  }
  function compare(a, b, field) {
    return txDate(a, field).localeCompare(txDate(b, field)) ||
      str(a.time).localeCompare(str(b.time)) ||
      Number(a.id || 0) - Number(b.id || 0);
  }
  function daysOld(date, asOf) {
    return date ? Math.max(0, Math.round((Date.parse(asOf + "T00:00:00Z") -
      Date.parse(date + "T00:00:00Z")) / 86400000)) : null;
  }
  function posted(rows, field, asOf) {
    return (Array.isArray(rows) ? rows : [])
      .filter(r => validDate(txDate(r, field)) && txDate(r, field) <= asOf)
      .slice().sort((a, b) => compare(a, b, field));
  }

  function bankEvidence(name, rows, asOf) {
    const ordered = posted(rows, "date", asOf);
    let prev = null;
    let compared = 0;
    let missingBalances = 0;
    let unknownSigns = 0;
    const issues = [];
    for (const row of ordered) {
      const balPresent = row.balance !== null && row.balance !== undefined &&
        Number.isFinite(Number(row.balance));
      if (!balPresent) {
        prev = null; // Never bridge across unknown balances.
        missingBalances++;
        continue;
      }
      const sign = str(row.sign);
      const signKnown = sign === "+" || sign === "-";
      if (!signKnown) unknownSigns++;
      if (prev && signKnown) {
        compared++;
        const expected = (sign === "+" ? 1 : -1) * cents(row.amount);
        const actual = cents(row.balance) - cents(prev.balance);
        const gap = actual - expected;
        if (Math.abs(gap) > 100) { // Rp 1.00 rounding tolerance.
          issues.push({
            id: Number(row.id), date: txDate(row), gapIdr: gap / 100,
            type: str(row.type) || "Statement record"
          });
        }
      }
      prev = row;
    }
    const latest = ordered.length ? [...ordered].reverse().find(row =>
      row.balance !== null && row.balance !== undefined &&
      Number.isFinite(Number(row.balance))) : null;
    issues.sort((a, b) => Math.abs(b.gapIdr) - Math.abs(a.gapIdr));
    return {
      name, count: ordered.length, latestDate: latest ? txDate(latest) : null,
      balanceIdr: latest ? num(latest.balance) : null,
      indicatedJpy: latest && latest.balance_jpy !== null &&
        latest.balance_jpy !== undefined && Number.isFinite(Number(latest.balance_jpy))
        ? num(latest.balance_jpy) : null,
      ageDays: daysOld(latest ? txDate(latest) : null, asOf),
      compared, missingBalances, unknownSigns,
      differences: issues.length, issues
    };
  }

  function ledgerEvidence(rows, asOf) {
    const valid = posted(rows, "tanggal", asOf).filter(x =>
      str(x.currency).toUpperCase() === "JPY");
    const checkpoint = [...valid].reverse().find(row =>
      row.saldo !== null && row.saldo !== undefined &&
      Number.isFinite(Number(row.saldo)));
    const movement = valid.filter(row => MOVEMENT_ITEMS.has(label(row))).reverse();
    return {
      posted: valid.length,
      balance: checkpoint ? num(checkpoint.saldo) : null,
      date: checkpoint ? txDate(checkpoint, "tanggal") : null,
      ageDays: daysOld(checkpoint ? txDate(checkpoint, "tanggal") : null, asOf),
      checkpointId: checkpoint ? Number(checkpoint.id) : null,
      movements: movement.map(row => ({
        id: Number(row.id), date: txDate(row, "tanggal"), label: label(row),
        change: num(row.pemasukan) - num(row.pengeluaran)
      }))
    };
  }

  function atmEvidence(rows, asOf) {
    const records = posted(rows, "tanggal", asOf);
    const bySource = new Map();
    let deposits = 0, withdrawals = 0, fees = 0;
    for (const row of records) {
      const source = str(row.source) || "Unspecified ATM";
      const type = str(row.type).toLowerCase();
      if (!bySource.has(source)) {
        bySource.set(source, { source, count: 0, deposits: 0, withdrawals: 0, fees: 0 });
      }
      const entry = bySource.get(source);
      entry.count++;
      entry.fees += num(row.fee);
      fees += num(row.fee);
      if (type === "withdrawal") {
        withdrawals += num(row.amount);
        entry.withdrawals += num(row.amount);
      } else if (type === "deposit") {
        deposits += num(row.amount);
        entry.deposits += num(row.amount);
      }
    }
    const lastDate = records.length ? txDate(records.at(-1), "tanggal") : null;
    return {
      count: records.length, latestDate: lastDate, ageDays: daysOld(lastDate, asOf),
      deposits, withdrawals, fees,
      sources: [...bySource.values()].sort((a, b) => b.count - a.count || a.source.localeCompare(b.source))
    };
  }

  function calculate(data, asOf) {
    const accounts = ACCOUNT_SOURCES.map(config => ({
      ...config, ...bankEvidence(config.name, data[config.key], asOf)
    }));
    const jp = posted(data.jpPost, "date", asOf);
    const latestJP = [...jp].reverse().find(row =>
      row.balance_jpy !== null && row.balance_jpy !== undefined &&
      Number.isFinite(Number(row.balance_jpy)));
    return {
      asOf, ledger: ledgerEvidence(data.cash, asOf),
      jpPost: { count: jp.length, balanceJpy: latestJP ? num(latestJP.balance_jpy) : null,
        date: latestJP ? txDate(latestJP) : null },
      accounts, atm: atmEvidence(data.withdrawals, asOf),
      totalDifferences: accounts.reduce((n, a) => n + a.differences, 0),
      manualAccounts: ["Cash wallet", "Japan Post Bank", "Hokuriku Bank"]
    };
  }

  function el(id) { return document.getElementById(id); }
  function put(id, value) { const node = el(id); if (node) node.textContent = String(value); }
  function add(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }
  function linkButton(text, target) {
    const button = add("button", "account-evidence-link", text);
    button.type = "button";
    button.dataset.accountNav = target;
    return button;
  }

  function renderAccounts(accounts) {
    const container = el("account-evidence-indonesia");
    if (!container) return;
    container.replaceChildren();
    for (const account of accounts) {
      const card = add("article", "account-evidence-card glass-panel");
      card.append(add("span", "account-evidence-kicker", "INDONESIA · IDR STATEMENT"));
      card.append(add("h3", "", account.name));
      const balance = add("strong", "account-evidence-amount", account.balanceIdr === null
        ? "No balance snapshot" : "Rp" + format(account.balanceIdr));
      card.append(balance);
      card.append(add("p", "account-evidence-muted", account.indicatedJpy === null
        ? "No stored JPY equivalent"
        : "Stored approximate JPY equivalent: ¥" + format(account.indicatedJpy)));
      card.append(add("p", "account-evidence-muted", account.latestDate
        ? "Last statement " + account.latestDate + " · " + account.ageDays + " days old"
        : "No posted statement"));
      card.append(add("p", "account-evidence-muted", account.count + " records · " +
        account.compared + " balance comparisons · " + account.differences +
        " difference(s)" + (account.missingBalances ? " · " + account.missingBalances + " missing balances" : "")));
      card.append(linkButton("View " + account.name + " statement →", account.target));
      container.append(card);
    }
  }

  function renderManual(jpEvidence = {}) {
    const container = el("account-evidence-japan");
    if (!container) return;
    container.replaceChildren();
    for (const name of ["Cash wallet", "Japan Post Bank", "Hokuriku Bank"]) {
      const card = add("article", "account-evidence-manual");
      card.append(add("strong", "", name));
      const hasJP = name === "Japan Post Bank" && jpEvidence.balanceJpy != null;
      card.append(add("span", "", hasJP ? "Historic balance: ¥" + format(jpEvidence.balanceJpy, 0) +
        " · " + jpEvidence.date + " · not live" : "Current balance not individually verified"));
      if (hasJP) card.append(linkButton("Open Japan Post Bank", "view-jp-post-account"));
      container.append(card);
    }
  }

  function renderBankDifferences(accounts) {
    const container = el("account-evidence-differences");
    if (!container) return;
    container.replaceChildren();
    const total = accounts.reduce((n, x) => n + x.differences, 0);
    if (!total) {
      container.append(add("p", "account-evidence-muted",
        "No native statement balance differences detected by the current checks."));
      return;
    }
    for (const account of accounts) {
      const head = add("div", "account-evidence-difference-heading",
        account.name + " · " + account.differences + " flagged pairs / " + account.compared + " checked");
      container.append(head);
      if (!account.differences) continue;
      for (const issue of account.issues.slice(0, 5)) {
        const button = linkButton(issue.date + " · " + issue.type + " · " +
          (issue.gapIdr < 0 ? "−" : "+") + "Rp" + format(issue.gapIdr), account.target);
        button.classList.add("account-evidence-difference");
        container.append(button);
      }
      if (account.issues.length > 5)
        container.append(add("p", "account-evidence-muted",
          "Showing largest 5 of " + account.differences + ". Open the statement for full history."));
    }
  }

  function renderMovements(movements) {
    const container = el("account-evidence-movements");
    if (!container) return;
    container.replaceChildren();
    if (!movements.length) {
      container.append(add("p", "account-evidence-muted", "No labeled JPY movement markers."));
      return;
    }
    for (const movement of movements.slice(0, 8)) {
      const button = add("button", "account-evidence-event");
      button.type = "button";
      button.dataset.accountTransaction = String(movement.id);
      const main = add("span");
      main.append(add("strong", "", movement.label));
      main.append(add("small", "", movement.date + " · JPY ledger marker"));
      button.append(main, add("b", "", signed(movement.change)));
      container.append(button);
    }
    if (movements.length > 8)
      container.append(add("p", "account-evidence-muted", "Showing latest 8 of " + movements.length + " ledger markers."));
  }

  function renderAtm(model) {
    const container = el("account-evidence-atm-list");
    if (!container) return;
    container.replaceChildren();
    if (!model.sources.length) {
      container.append(add("p", "account-evidence-muted", "No posted ATM activity records."));
      return;
    }
    for (const source of model.sources) {
      const item = add("div", "account-evidence-atm-row");
      item.append(add("strong", "", source.source + " · " + source.count + " item(s)"));
      item.append(add("span", "", "Withdrawal ¥" + format(source.withdrawals, 0) +
        " · Deposit ¥" + format(source.deposits, 0) +
        " · Fees ¥" + format(source.fees, 0)));
      container.append(item);
    }
  }

  function render() {
    const m = calculate(datasets, todayTokyo());
    put("account-evidence-jpy-balance", m.ledger.balance === null ? "—" : "¥" + format(m.ledger.balance));
    put("account-evidence-jpy-meta", m.ledger.date
      ? "JPY ledger checkpoint " + m.ledger.date + " · " + m.ledger.ageDays + " days old"
      : "No recorded JPY balance checkpoint");
    put("account-evidence-idr-accounts", m.accounts.filter(a => a.balanceIdr !== null).length + " / 3");
    put("account-evidence-idr-meta", "IDR-native accounts with stored balance snapshots");
    put("account-evidence-bank-checks", m.totalDifferences);
    put("account-evidence-bank-meta", m.accounts.reduce((n,a) => n + a.compared, 0) + " native-IDR comparisons");
    put("account-evidence-atm", m.atm.count);
    put("account-evidence-atm-meta", "ATM activity records · last " + (m.atm.latestDate || "unknown"));
    put("account-evidence-movement-total", m.ledger.movements.length);
    put("account-evidence-movement-note", "Labeled JPY ledger markers, not automatically paired transfers");
    put("account-evidence-atm-flow", "Withdrawals ¥" + format(m.atm.withdrawals, 0) +
      " · deposits ¥" + format(m.atm.deposits, 0) +
      " · fees ¥" + format(m.atm.fees, 0));
    renderAccounts(m.accounts);
    renderManual(m.jpPost);
    renderBankDifferences(m.accounts);
    renderMovements(m.ledger.movements);
    renderAtm(m.atm);
  }

  function setData(next = {}) {
    for (const key of Object.keys(datasets))
      datasets[key] = Array.isArray(next[key]) ? next[key] : [];
    render();
  }
  function init() {
    el("view-account-evidence")?.addEventListener("click", event => {
      const nav = event.target.closest("[data-account-nav]");
      if (nav) {
        const target = nav.dataset.accountNav;
        document.querySelector('.nav-btn[data-target="' + target + '"]')?.click();
        return;
      }
      const tx = event.target.closest("[data-account-transaction]");
      if (tx) {
        const id = Number(tx.dataset.accountTransaction);
        if (Number.isFinite(id))
          window.dispatchEvent(new CustomEvent("budget:open-transaction", { detail: { id } }));
      }
    });
    render();
  }

  if (typeof window !== "undefined")
    window.FinanceAccountEvidence = { init, setData, render };
  if (typeof module !== "undefined" && module.exports)
    module.exports = {
      snapshotForTest({ data = {}, asOf = "2026-10-14" } = {}) {
        const clean = { cash: [], withdrawals: [], bni: [], muamalat: [], gopay: [], jpPost: [], ...data };
        return calculate(clean, asOf);
      }
    };
})();
