(() => {
  "use strict";

  const EXCLUDED_ITEMS = new Set([
    "Self-Transfer (Internal)",
    "Bank Inflow / Auto-Deposit",
    "Loan Repayment (Ryan)",
    "Balance Reconciliation"
  ]);

  let cash = [];
  let budgets = [];
  let selectedMonth = "";
  let monthTouched = false;

  function todayTokyo() {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).formatToParts(new Date()).filter(p => p.type !== "literal").map(p => [p.type, p.value])
    );
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function currentMonthTokyo() {
    return todayTokyo().slice(0, 7);
  }

  function shiftMonth(month, delta) {
    const [year, m] = month.split("-").map(Number);
    const d = new Date(Date.UTC(year, m - 1 + delta, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  function monthLabel(month) {
    if (!/^\d{4}-\d{2}$/.test(month)) return month || "—";
    const [year, m] = month.split("-").map(Number);
    return new Intl.DateTimeFormat("en", { month: "long", year: "numeric" })
      .format(new Date(Date.UTC(year, m - 1, 1)));
  }

  function amount(value) {
    return Number(value) || 0;
  }

  function formatMoney(value) {
    return new Intl.NumberFormat("ja-JP", {
      maximumFractionDigits: 0
    }).format(Math.round(Number(value) || 0));
  }

  function itemName(item) {
    return String(item?.item_normalized || item?.item || "Transaction");
  }

  function categoryOf(item) {
    return String(item?.kategori_normalized || item?.kategori || "Others").trim() || "Others";
  }

  function isExcluded(item) {
    return EXCLUDED_ITEMS.has(itemName(item));
  }

  function monthRows(month) {
    const today = todayTokyo();
    return cash.filter(item => {
      const date = String(item?.tanggal || "").slice(0, 10);
      if (!date || date.slice(0, 7) !== month) return false;
      if (month === currentMonthTokyo() && date > today) return false;
      if (month > currentMonthTokyo()) return false;
      return !isExcluded(item);
    });
  }

  function summarizeMonth(month) {
    const rows = monthRows(month);
    const income = rows.reduce((sum, item) => sum + Math.max(0, amount(item.pemasukan)), 0);
    const expenses = rows.reduce((sum, item) => sum + Math.max(0, amount(item.pengeluaran)), 0);
    const refunds = rows.reduce((sum, item) => sum + Math.abs(Math.min(0, amount(item.pengeluaran))), 0);
    const netExpenses = Math.max(0, expenses - refunds);
    const net = income - netExpenses;
    const savingsRate = income > 0 ? net / income * 100 : null;

    return {
      rows,
      income,
      expenses,
      refunds,
      netExpenses,
      net,
      savingsRate
    };
  }

  function activeMonths() {
    return [...new Set(
      cash.map(item => String(item?.tanggal || "").slice(0, 7))
        .filter(month => /^\d{4}-\d{2}$/.test(month))
        .filter(month => month <= currentMonthTokyo())
    )].sort();
  }

  function defaultMonth() {
    const months = activeMonths();
    const current = currentMonthTokyo();
    const complete = months.filter(month => month < current);
    return complete.at(-1) || months.at(-1) || current;
  }

  function selectedBudgetRows(month) {
    return budgets.filter(b => String(b?.month_start || "").slice(0, 7) === month);
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value);
  }

  function setTone(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove("positive", "negative");
    if (value > 0) el.classList.add("positive");
    if (value < 0) el.classList.add("negative");
  }

  function renderMonthPicker() {
    const select = document.getElementById("review-month");
    if (!select) return;

    const months = activeMonths().sort().reverse();
    const currentValue = selectedMonth;
    select.replaceChildren();

    months.forEach(month => {
      const option = document.createElement("option");
      option.value = month;
      option.textContent = monthLabel(month) + (month === currentMonthTokyo() ? " · in progress" : "");
      select.appendChild(option);
    });

    if (!months.includes(currentValue)) selectedMonth = defaultMonth();
    select.value = selectedMonth;
  }

  function renderSummary() {
    const current = summarizeMonth(selectedMonth);
    const previousMonth = shiftMonth(selectedMonth, -1);
    const previous = summarizeMonth(previousMonth);

    setText("review-month-title", monthLabel(selectedMonth));
    setText("review-income", `¥${formatMoney(current.income)}`);
    setText("review-spending", `¥${formatMoney(current.netExpenses)}`);
    setText("review-net", `${current.net < 0 ? "−" : ""}¥${formatMoney(Math.abs(current.net))}`);
    setText("review-savings-rate", current.savingsRate === null ? "—" : `${current.savingsRate.toFixed(1)}%`);
    setTone("review-net", current.net);
    setTone("review-savings-rate", current.savingsRate ?? 0);

    const spendingDelta = previous.netExpenses > 0
      ? (current.netExpenses - previous.netExpenses) / previous.netExpenses * 100
      : null;
    const incomeDelta = previous.income > 0
      ? (current.income - previous.income) / previous.income * 100
      : null;

    setText("review-spending-change", spendingDelta === null
      ? "No prior-month baseline"
      : `${spendingDelta >= 0 ? "+" : "−"}${Math.abs(spendingDelta).toFixed(1)}% vs ${monthLabel(previousMonth)}`);
    setText("review-income-change", incomeDelta === null
      ? "No prior-month baseline"
      : `${incomeDelta >= 0 ? "+" : "−"}${Math.abs(incomeDelta).toFixed(1)}% vs ${monthLabel(previousMonth)}`);
    setText("review-row-count", `${current.rows.length} posted transaction${current.rows.length === 1 ? "" : "s"}`);

    const status = document.getElementById("review-period-status");
    if (status) {
      const inProgress = selectedMonth === currentMonthTokyo();
      status.textContent = inProgress ? "In progress" : "Complete month";
      status.className = `review-period-badge ${inProgress ? "in-progress" : "complete"}`;
    }

    return current;
  }

  function renderCategories(summary) {
    const list = document.getElementById("review-category-list");
    if (!list) return;
    list.replaceChildren();

    const totals = new Map();
    summary.rows.forEach(item => {
      const rawExpense = amount(item.pengeluaran);
      if (rawExpense === 0) return;
      const category = categoryOf(item);
      totals.set(category, (totals.get(category) || 0) + rawExpense);
    });

    const rows = [...totals.entries()]
      .map(([category, rawValue]) => {
        const value = Math.max(0, rawValue);
        return {
        category,
        value,
        share: summary.netExpenses > 0 ? value / summary.netExpenses : 0
        };
      })
      .filter(row => row.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);

    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "review-empty";
      empty.textContent = "No expense categories recorded for this month.";
      list.appendChild(empty);
      return;
    }

    rows.forEach(row => {
      const article = document.createElement("article");
      article.className = "review-category-row";

      const top = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = row.category;
      const value = document.createElement("span");
      value.textContent = `¥${formatMoney(row.value)} · ${Math.round(row.share * 100)}%`;
      top.append(title, value);

      const progress = document.createElement("div");
      progress.className = "review-category-progress";
      const fill = document.createElement("span");
      fill.style.width = `${Math.max(2, Math.min(100, row.share * 100))}%`;
      progress.appendChild(fill);

      article.append(top, progress);
      list.appendChild(article);
    });
  }

  function renderLargestTransactions(summary) {
    const list = document.getElementById("review-largest-list");
    if (!list) return;
    list.replaceChildren();

    const rows = summary.rows
      .map(item => ({
        item,
        amount: Math.max(0, amount(item.pengeluaran))
      }))
      .filter(row => row.amount > 0)
      .sort((a, b) => b.amount - a.amount || Number(b.item.id || 0) - Number(a.item.id || 0))
      .slice(0, 8);

    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "review-empty";
      empty.textContent = "No expense transactions recorded for this month.";
      list.appendChild(empty);
      return;
    }

    rows.forEach(({ item, amount: value }) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "review-largest-row";
      row.dataset.reviewTransaction = String(item.id);

      const copy = document.createElement("span");
      const title = document.createElement("strong");
      title.textContent = itemName(item);
      const meta = document.createElement("small");
      meta.textContent = [
        String(item.tanggal || "").slice(0, 10),
        categoryOf(item),
        item.tempat || null
      ].filter(Boolean).join(" · ");
      copy.append(title, meta);

      const amountEl = document.createElement("strong");
      amountEl.textContent = `−¥${formatMoney(value)}`;

      row.append(copy, amountEl);
      list.appendChild(row);
    });
  }

  function renderBudgetVariance(summary) {
    const panel = document.getElementById("review-budget-panel");
    const list = document.getElementById("review-budget-list");
    const empty = document.getElementById("review-budget-empty");
    if (!panel || !list || !empty) return;

    const targets = selectedBudgetRows(selectedMonth);
    list.replaceChildren();

    if (!targets.length) {
      empty.classList.remove("hidden");
      panel.classList.add("no-budget");
      setText("review-budget-planned", "¥0");
      setText("review-budget-actual", "¥0");
      setText("review-budget-variance", "—");
      return;
    }

    empty.classList.add("hidden");
    panel.classList.remove("no-budget");

    const actualMap = new Map();
    summary.rows.forEach(item => {
      const expense = amount(item.pengeluaran);
      if (expense === 0) return;
      const category = categoryOf(item);
      actualMap.set(category, (actualMap.get(category) || 0) + expense);
    });

    const rows = targets.map(target => {
      const planned = amount(target.amount);
      const actual = Math.max(0, actualMap.get(target.category) || 0);
      return {
        category: target.category,
        planned,
        actual,
        variance: planned - actual,
        ratio: planned > 0 ? actual / planned : 0
      };
    }).sort((a, b) => b.ratio - a.ratio);

    const plannedTotal = rows.reduce((sum, row) => sum + row.planned, 0);
    const actualTotal = rows.reduce((sum, row) => sum + row.actual, 0);
    const varianceTotal = plannedTotal - actualTotal;

    setText("review-budget-planned", `¥${formatMoney(plannedTotal)}`);
    setText("review-budget-actual", `¥${formatMoney(actualTotal)}`);
    setText("review-budget-variance", `${varianceTotal < 0 ? "−" : "+"}¥${formatMoney(Math.abs(varianceTotal))}`);
    setTone("review-budget-variance", varianceTotal);

    rows.forEach(row => {
      const article = document.createElement("article");
      article.className = "review-budget-row";

      const top = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = row.category;
      const status = document.createElement("span");
      status.className = row.variance < 0 ? "over" : "under";
      status.textContent = row.variance < 0
        ? `Over ¥${formatMoney(Math.abs(row.variance))}`
        : `Under ¥${formatMoney(row.variance)}`;
      top.append(title, status);

      const meta = document.createElement("p");
      meta.textContent = `Actual ¥${formatMoney(row.actual)} of ¥${formatMoney(row.planned)} target · ${Math.round(row.ratio * 100)}%`;

      article.append(top, meta);
      list.appendChild(article);
    });
  }

  function renderSignals(summary) {
    const list = document.getElementById("review-signal-list");
    if (!list) return;
    list.replaceChildren();

    const signals = [];
    const previous = summarizeMonth(shiftMonth(selectedMonth, -1));

    if (previous.netExpenses > 0) {
      const delta = (summary.netExpenses - previous.netExpenses) / previous.netExpenses * 100;
      signals.push({
        tone: delta > 15 ? "warning" : delta < -10 ? "good" : "neutral",
        icon: delta > 0 ? "fa-arrow-trend-up" : "fa-arrow-trend-down",
        title: delta > 0 ? "Spending increased" : "Spending decreased",
        text: `${Math.abs(delta).toFixed(1)}% ${delta > 0 ? "higher" : "lower"} than ${monthLabel(shiftMonth(selectedMonth, -1))}.`
      });
    }

    if (summary.savingsRate !== null) {
      signals.push({
        tone: summary.savingsRate < 0 ? "warning" : summary.savingsRate >= 20 ? "good" : "neutral",
        icon: summary.savingsRate < 0 ? "fa-triangle-exclamation" : "fa-piggy-bank",
        title: summary.savingsRate < 0 ? "Negative monthly net" : "Savings rate",
        text: `Savings rate for the selected month was ${summary.savingsRate.toFixed(1)}%.`
      });
    }

    const largest = summary.rows
      .map(item => Math.max(0, amount(item.pengeluaran)))
      .sort((a, b) => b - a)[0] || 0;
    if (largest > 0 && summary.netExpenses > 0) {
      const share = largest / summary.netExpenses * 100;
      if (share >= 20) {
        signals.push({
          tone: "neutral",
          icon: "fa-receipt",
          title: "One large expense shaped the month",
          text: `The largest transaction represented ${share.toFixed(1)}% of monthly spending.`
        });
      }
    }

    const targetRows = selectedBudgetRows(selectedMonth);
    if (targetRows.length) {
      signals.push({
        tone: "good",
        icon: "fa-bullseye",
        title: "Budget targets available",
        text: `${targetRows.length} category target${targetRows.length === 1 ? "" : "s"} can be reviewed against actual spending below.`
      });
    }

    if (!signals.length) {
      signals.push({
        tone: "neutral",
        icon: "fa-circle-info",
        title: "Limited comparison data",
        text: "This month does not yet have enough prior or income data for additional signals."
      });
    }

    signals.slice(0, 4).forEach(signal => {
      const article = document.createElement("article");
      article.className = `review-signal ${signal.tone}`;
      const icon = document.createElement("span");
      icon.className = "review-signal-icon";
      const i = document.createElement("i");
      i.className = `fa-solid ${signal.icon}`;
      icon.appendChild(i);
      const body = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = signal.title;
      const p = document.createElement("p");
      p.textContent = signal.text;
      body.append(title, p);
      article.append(icon, body);
      list.appendChild(article);
    });
  }

  function render() {
    if (!selectedMonth) selectedMonth = defaultMonth();
    renderMonthPicker();
    const summary = renderSummary();
    renderCategories(summary);
    renderLargestTransactions(summary);
    renderBudgetVariance(summary);
    renderSignals(summary);
  }

  function setData(next = {}) {
    cash = Array.isArray(next.cash) ? next.cash : [];
    budgets = Array.isArray(next.budgets) ? next.budgets : [];
    if (!monthTouched) selectedMonth = defaultMonth();
    render();
  }

  function init() {
    document.getElementById("review-month")?.addEventListener("change", event => {
      monthTouched = true;
      selectedMonth = event.target.value || defaultMonth();
      render();
    });

    document.getElementById("review-largest-list")?.addEventListener("click", event => {
      const button = event.target.closest("[data-review-transaction]");
      if (!button) return;
      window.dispatchEvent(new CustomEvent("budget:open-transaction", {
        detail: { id: Number(button.dataset.reviewTransaction) }
      }));
    });

    render();
  }

  window.MonthlyReview = {
    init,
    setData,
    render
  };
})();