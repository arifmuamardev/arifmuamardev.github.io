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
  let asOfOverride = null; // Node test harness only; never set in the browser.

  function todayTokyo() {
    if (asOfOverride) return asOfOverride;
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

  function addDays(dateString, days) {
    const [y, m, d] = dateString.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d + days));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  }

  function amount(value) {
    return Number(value) || 0;
  }

  function itemName(item) {
    return String(item?.item_normalized || item?.item || "Transaction");
  }

  function categoryOf(item) {
    return String(item?.kategori_normalized || item?.kategori || "Others").trim() || "Others";
  }

  function dateOf(item) {
    return String(item?.tanggal || "").slice(0, 10);
  }

  function formatMoney(value, digits = 0) {
    return new Intl.NumberFormat("ja-JP", {
      maximumFractionDigits: digits
    }).format(Number(value) || 0);
  }

  function isExcluded(item) {
    return EXCLUDED_ITEMS.has(itemName(item));
  }

  function postedRows() {
    const today = todayTokyo();
    return cash.filter(item => {
      const date = dateOf(item);
      return date && date <= today;
    });
  }

  function scheduledRows() {
    const today = todayTokyo();
    return cash.filter(item => {
      const date = dateOf(item);
      return date && date > today;
    }).sort((a, b) =>
      dateOf(a).localeCompare(dateOf(b)) ||
      Number(a.id || 0) - Number(b.id || 0)
    );
  }

  function netSpend(rows) {
    return Math.max(0, rows.reduce((sum, item) => {
      if (isExcluded(item)) return sum;
      return sum + amount(item.pengeluaran);
    }, 0));
  }

  function scheduledImpact(rows) {
    return rows.reduce((acc, item) => {
      if (isExcluded(item)) return acc;
      const income = Math.max(0, amount(item.pemasukan));
      const expense = amount(item.pengeluaran);
      if (income > 0) acc.inflow += income;
      if (expense > 0) acc.outflow += expense;
      if (expense < 0) acc.inflow += Math.abs(expense);
      return acc;
    }, { inflow: 0, outflow: 0 });
  }

  function latestBalanceInfo() {
    const row = postedRows()
      .filter(item => item?.saldo !== null && item?.saldo !== undefined && Number.isFinite(Number(item.saldo)))
      .sort((a, b) =>
        dateOf(b).localeCompare(dateOf(a)) ||
        Number(b.id || 0) - Number(a.id || 0)
      )[0];
    return row ? {
      value: amount(row.saldo),
      date: dateOf(row),
      id: Number(row.id)
    } : null;
  }

  function latestPostedDate() {
    return postedRows()
      .map(dateOf)
      .filter(Boolean)
      .sort()
      .at(-1) || null;
  }

  function daysBetween(from, to) {
    if (!from || !to) return null;
    const a = new Date(`${from}T00:00:00Z`);
    const b = new Date(`${to}T00:00:00Z`);
    return Math.max(0, Math.floor((b - a) / 86400000));
  }

  function monthSpend(month) {
    return netSpend(postedRows().filter(item => dateOf(item).slice(0, 7) === month));
  }

  function historicalMonths() {
    const current = currentMonthTokyo();
    return [-3, -2, -1].map(offset => {
      const month = shiftMonth(current, offset);
      return {
        month,
        spend: monthSpend(month),
        hasRecords: postedRows().some(item => dateOf(item).slice(0, 7) === month)
      };
    });
  }

  function median(values) {
    const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
    if (!sorted.length) return 0;
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function monthLabel(month) {
    const [y, m] = month.split("-").map(Number);
    return new Intl.DateTimeFormat("en", { month: "short", year: "numeric" })
      .format(new Date(Date.UTC(y, m - 1, 1)));
  }

  function currentBudgetSummary() {
    const month = currentMonthTokyo();
    const targets = budgets.filter(b => String(b?.month_start || "").slice(0, 7) === month);
    const actualMap = new Map();

    postedRows()
      .filter(item => dateOf(item).slice(0, 7) === month && !isExcluded(item))
      .forEach(item => {
        const expense = amount(item.pengeluaran);
        if (expense === 0) return;
        const category = categoryOf(item);
        actualMap.set(category, (actualMap.get(category) || 0) + expense);
      });

    const details = targets.map(target => {
      const planned = amount(target.amount);
      const spent = Math.max(0, actualMap.get(target.category) || 0);
      return {
        category: target.category,
        planned,
        spent,
        remaining: Math.max(0, planned - spent)
      };
    });

    return {
      count: targets.length,
      planned: details.reduce((sum, row) => sum + row.planned, 0),
      spent: details.reduce((sum, row) => sum + row.spent, 0),
      remaining: details.reduce((sum, row) => sum + row.remaining, 0)
    };
  }

  function calculate() {
    const today = todayTokyo();
    const balance = latestBalanceInfo();
    const scheduled = scheduledRows();
    const horizon30 = addDays(today, 30);
    const horizon90 = addDays(today, 90);
    const next30 = scheduled.filter(item => dateOf(item) <= horizon30);
    const next90 = scheduled.filter(item => dateOf(item) <= horizon90);
    const impact30 = scheduledImpact(next30);
    const currentMonthSpend = monthSpend(currentMonthTokyo());
    const history = historicalMonths();
    // Missing calendar months are unknown, not zero spending.
    const monthsWithRecords = history.filter(row => row.hasRecords).length;
    const medianSpend = monthsWithRecords === 3
      ? median(history.map(row => row.spend))
      : null;
    const remainingToMedian = medianSpend === null
      ? null
      : Math.max(0, medianSpend - currentMonthSpend);
    const knownBalance30 = balance
      ? balance.value + impact30.inflow - impact30.outflow
      : null;
    const historicalScenarioBalance = balance && remainingToMedian !== null
      ? balance.value - remainingToMedian
      : null;

    // Current-month scheduled outflows already contribute toward the monthly
    // historical benchmark. Subtract them only once in the combined stress.
    const currentMonthKnownOutflow = scheduledImpact(
      next30.filter(item => dateOf(item).slice(0, 7) === currentMonthTokyo())
    ).outflow;
    const additionalStressOutflow = medianSpend === null
      ? null
      : Math.max(0, medianSpend - currentMonthSpend - currentMonthKnownOutflow);
    const combinedStressBalance = balance && additionalStressOutflow !== null
      ? balance.value - impact30.outflow - additionalStressOutflow
      : null;
    const runway = balance && medianSpend > 0
      ? balance.value / medianSpend
      : null;
    const latestPosted = latestPostedDate();
    const freshnessDays = daysBetween(latestPosted, today);
    const budget = currentBudgetSummary();

    let confidence = "Limited";
    let confidenceTone = "limited";
    if (monthsWithRecords === 3 && freshnessDays !== null && freshnessDays <= 3) {
      confidence = "Moderate";
      confidenceTone = "moderate";
    } else if (monthsWithRecords === 3 && freshnessDays !== null && freshnessDays <= 7) {
      confidence = "Cautious";
      confidenceTone = "cautious";
    }

    return {
      today,
      balance,
      scheduled,
      next30,
      next90,
      impact30,
      currentMonthSpend,
      history,
      medianSpend,
      monthsWithRecords,
      remainingToMedian,
      knownBalance30,
      historicalScenarioBalance,
      currentMonthKnownOutflow,
      additionalStressOutflow,
      combinedStressBalance,
      runway,
      latestPosted,
      freshnessDays,
      confidence,
      confidenceTone,
      budget
    };
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value);
  }

  function setMoney(id, value, fallback = "—", digits = 0) {
    setText(id, value === null || value === undefined
      ? fallback
      : `${value < 0 ? "−" : ""}¥${formatMoney(Math.abs(value), digits)}`
    );
  }

  function renderSummary(model) {
    setMoney("forecast-recorded-balance", model.balance?.value ?? null);
    setText("forecast-balance-date", model.balance
      ? `Recorded ${model.balance.date}`
      : "No running balance available"
    );

    setMoney("forecast-known-30d", model.impact30.outflow, "—", 2);
    setText("forecast-known-30d-meta",
      `${model.next30.length} scheduled item${model.next30.length === 1 ? "" : "s"} · +¥${formatMoney(model.impact30.inflow)} known inflow`
    );

    setMoney("forecast-known-balance", model.knownBalance30, "—", 2);
    setText("forecast-known-balance-meta", "Recorded balance after known 30-day cash-flow items");

    setMoney("forecast-median-spend", model.medianSpend);
    setText("forecast-median-spend-meta", model.medianSpend === null
      ? "Insufficient records across the prior 3 calendar months"
      : "Median of the prior 3 calendar months with recorded activity");

    const badge = document.getElementById("forecast-confidence");
    if (badge) {
      badge.textContent = `${model.confidence} confidence`;
      badge.className = `forecast-confidence ${model.confidenceTone}`;
    }
  }

  function renderScenarios(model) {
    setMoney("forecast-scenario-known", model.knownBalance30, "—", 2);
    setText("forecast-scenario-known-detail",
      `Uses only ${model.next30.length} future-dated ledger item${model.next30.length === 1 ? "" : "s"} within 30 days. No unscheduled spending is assumed.`
    );

    setMoney("forecast-scenario-median", model.historicalScenarioBalance);
    setText("forecast-scenario-median-detail",
      model.medianSpend !== null
        ? `Stress-test balance if current-month spending rises from ¥${formatMoney(model.currentMonthSpend)} toward the recent 3-month median of ¥${formatMoney(model.medianSpend)}. Future income is ignored.`
        : "Unavailable: at least one of the prior three months has no recorded transactions."
    );

    setMoney("forecast-scenario-combined", model.combinedStressBalance, "—", 2);
    setText("forecast-scenario-combined-detail", model.combinedStressBalance === null
      ? "Unavailable until all three prior calendar months have transaction records."
      : `Deducts ¥${formatMoney(model.impact30.outflow, 2)} known 30-day outflows plus ¥${formatMoney(model.additionalStressOutflow, 2)} extra current-month spending. ¥${formatMoney(model.currentMonthKnownOutflow, 2)} of the scheduled outflow already counts toward the monthly benchmark. No double-counting or future income assumed.`
    );

    setText("forecast-runway", model.runway === null ? "—" : `${model.runway.toFixed(1)} months`);
    setText("forecast-runway-detail",
      model.runway === null
        ? "Not enough balance or historical spending data."
        : "Recorded balance divided by recent median monthly spending. This is a stress test and ignores future income."
    );

    const budgetCard = document.getElementById("forecast-budget-scenario");
    if (budgetCard) budgetCard.classList.toggle("hidden", model.budget.count === 0);
    setMoney("forecast-budget-remaining", model.budget.remaining);
    setText("forecast-budget-detail",
      `${model.budget.count} saved category target${model.budget.count === 1 ? "" : "s"} · ¥${formatMoney(model.budget.spent)} spent of ¥${formatMoney(model.budget.planned)} planned`
    );
  }

  function renderUpcoming(model) {
    const list = document.getElementById("forecast-upcoming-list");
    if (!list) return;
    list.replaceChildren();

    if (!model.next90.length) {
      const empty = document.createElement("div");
      empty.className = "forecast-empty";
      empty.textContent = "No future-dated ledger entries in the next 90 days.";
      list.appendChild(empty);
      return;
    }

    model.next90.forEach(item => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "forecast-upcoming-row";
      row.dataset.forecastTransaction = String(item.id);

      const date = document.createElement("time");
      date.dateTime = dateOf(item);
      date.textContent = dateOf(item);

      const copy = document.createElement("span");
      const title = document.createElement("strong");
      title.textContent = itemName(item);
      const meta = document.createElement("small");
      meta.textContent = [categoryOf(item), item.tempat || null].filter(Boolean).join(" · ");
      copy.append(title, meta);

      const flow = document.createElement("strong");
      const income = Math.max(0, amount(item.pemasukan)) + Math.abs(Math.min(0, amount(item.pengeluaran)));
      const expense = Math.max(0, amount(item.pengeluaran));
      flow.className = income > 0 ? "income" : "expense";
      flow.textContent = income > 0
        ? `+¥${formatMoney(income, 2)}`
        : `−¥${formatMoney(expense, 2)}`;

      row.append(date, copy, flow);
      list.appendChild(row);
    });
  }

  function renderHistory(model) {
    const list = document.getElementById("forecast-history-list");
    if (!list) return;
    list.replaceChildren();

    const current = {
      month: currentMonthTokyo(),
      spend: model.currentMonthSpend,
      current: true
    };
    const rows = [...model.history, current];
    const maxSpend = Math.max(1, ...rows.map(row => row.spend));

    rows.forEach(row => {
      const article = document.createElement("article");
      article.className = "forecast-history-row";

      const label = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = monthLabel(row.month);
      const meta = document.createElement("span");
      meta.textContent = row.current ? "Posted MTD" : row.hasRecords ? "Recorded month" : "No records · excluded";
      label.append(title, meta);

      const bar = document.createElement("div");
      bar.className = "forecast-history-bar";
      const fill = document.createElement("span");
      fill.style.width = !row.current && !row.hasRecords
        ? "0%"
        : `${Math.max(1, row.spend / maxSpend * 100)}%`;
      if (row.current) fill.classList.add("current");
      bar.appendChild(fill);

      const value = document.createElement("strong");
      value.textContent = !row.current && !row.hasRecords ? "—" : `¥${formatMoney(row.spend)}`;

      article.append(label, bar, value);
      list.appendChild(article);
    });
  }

  function renderQuality(model) {
    setText("forecast-freshness",
      model.freshnessDays === null
        ? "No posted date"
        : model.freshnessDays === 0
          ? "Updated today"
          : `${model.freshnessDays} day${model.freshnessDays === 1 ? "" : "s"} since latest posted transaction`
    );
    setText("forecast-history-basis",
      `${model.monthsWithRecords}/3 prior calendar months contain transactions (not proof of complete reporting)`
    );
    setText("forecast-scheduled-count",
      `${model.next90.length} known future item${model.next90.length === 1 ? "" : "s"} within 90 days`
    );

    const warning = document.getElementById("forecast-quality-warning");
    if (warning) {
      const stale = model.freshnessDays === null || model.freshnessDays > 7;
      const missing = model.history.filter(row => !row.hasRecords).map(row => monthLabel(row.month));
      warning.classList.toggle("hidden", !(stale || missing.length));
      const notes = [];
      if (stale) notes.push(model.freshnessDays === null
        ? "No dated posted transactions are available."
        : `Latest posted transaction is ${model.latestPosted}, ${model.freshnessDays} days before today.`);
      if (missing.length) notes.push(`Missing ledger records for ${missing.join(", ")}; historical scenarios are disabled rather than treating missing months as zero.`);
      warning.textContent = notes.join(" ");
    }
  }

  function render() {
    const model = calculate();
    renderSummary(model);
    renderScenarios(model);
    renderUpcoming(model);
    renderHistory(model);
    renderQuality(model);
  }

  function setData(next = {}) {
    cash = Array.isArray(next.cash) ? next.cash : [];
    budgets = Array.isArray(next.budgets) ? next.budgets : [];
    render();
  }

  function init() {
    document.getElementById("forecast-upcoming-list")?.addEventListener("click", event => {
      const button = event.target.closest("[data-forecast-transaction]");
      if (!button) return;
      window.dispatchEvent(new CustomEvent("budget:open-transaction", {
        detail: { id: Number(button.dataset.forecastTransaction) }
      }));
    });
    render();
  }

  if (typeof window !== "undefined") {
    window.FinanceForecast = { init, setData, render };
  }

  // Test-only adapter, available in Node and never exposed to the browser.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      snapshotForTest({ rows = [], budgetRows = [], asOf = "2026-10-14" } = {}) {
        cash = rows;
        budgets = budgetRows;
        asOfOverride = asOf;
        try {
          return calculate();
        } finally {
          cash = [];
          budgets = [];
          asOfOverride = null;
        }
      }
    };
  }
})();