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

  function monthStart(month) {
    return `${month}-01`;
  }

  function monthLabel(month) {
    if (!/^\d{4}-\d{2}$/.test(month)) return month;
    const [year, m] = month.split("-").map(Number);
    return new Intl.DateTimeFormat("en", { month: "long", year: "numeric" })
      .format(new Date(Date.UTC(year, m - 1, 1)));
  }

  function shiftMonth(month, delta) {
    const [year, m] = month.split("-").map(Number);
    const d = new Date(Date.UTC(year, m - 1 + delta, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  function amount(value) {
    return Number(value) || 0;
  }

  function formatMoney(value) {
    return new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 }).format(Math.round(Number(value) || 0));
  }

  function isExpense(item) {
    const classifier=typeof window!=="undefined" ? window.FinanceFlowClassifier :
      (typeof require!=="undefined" ? require("./flow-classifier.js") : null);
    if(classifier)return amount(item?.pengeluaran)!==0 && classifier.classify(item).kind==="spending";
    return amount(item?.pengeluaran) !== 0 &&
      !EXCLUDED_ITEMS.has(String(item?.item_normalized || item?.item || ""));
  }

  function categoryOf(item) {
    return String(item?.kategori_normalized || item?.kategori || "Others").trim() || "Others";
  }

  function actualRows(month) {
    const today = todayTokyo();
    return cash.filter(item => {
      const date = String(item?.tanggal || "").slice(0, 10);
      if (!date || date.slice(0, 7) !== month) return false;
      if (month === currentMonthTokyo() && date > today) return false;
      if (month > currentMonthTokyo()) return false;
      return isExpense(item);
    });
  }

  function actualByCategory(month) {
    const map = new Map();
    actualRows(month).forEach(item => {
      const category = categoryOf(item);
      map.set(category, (map.get(category) || 0) + amount(item.pengeluaran));
    });
    return map;
  }

  function historicalSuggestions(month) {
    const months = [-3, -2, -1].map(offset => shiftMonth(month, offset));
    const totals = new Map();

    months.forEach(m => {
      const byCategory = new Map();
      cash.filter(item =>
        String(item?.tanggal || "").slice(0, 7) === m &&
        isExpense(item)
      ).forEach(item => {
        const category = categoryOf(item);
        if (category.toLowerCase() === "others") return;
        byCategory.set(category, (byCategory.get(category) || 0) + amount(item.pengeluaran));
      });

      byCategory.forEach((value, category) => {
        if (!totals.has(category)) totals.set(category, { total: 0, months: 0 });
        const entry = totals.get(category);
        entry.total += value;
        entry.months += 1;
      });
    });

    return [...totals.entries()]
      .map(([category, entry]) => ({
        category,
        suggested: entry.total / 3,
        activeMonths: entry.months,
        basisMonths: months
      }))
      .filter(row => row.suggested > 0)
      .sort((a, b) => b.suggested - a.suggested);
  }

  function selectedBudgets() {
    return budgets
      .filter(b => String(b.month_start || "").slice(0, 7) === selectedMonth)
      .sort((a, b) => String(a.category).localeCompare(String(b.category)));
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value);
  }

  function setProgress(el, ratio) {
    if (!el) return;
    const pct = Math.max(0, Math.min(100, ratio * 100));
    el.style.width = `${pct}%`;
    el.dataset.level = ratio > 1 ? "over" : ratio >= .8 ? "warning" : "ok";
  }

  function renderSummary() {
    const actualMap = actualByCategory(selectedMonth);
    const targets = selectedBudgets();
    const planned = targets.reduce((sum, b) => sum + amount(b.amount), 0);
    const spent = targets.reduce((sum, b) => sum + (actualMap.get(b.category) || 0), 0);
    // A refund-only category is a credit, not a negative slice of the budget
    // coverage denominator. Coverage refers to positive net category spending.
    const positiveActual = [...actualMap.values()].reduce((sum,v)=>sum+Math.max(0,v),0);
    const positiveBudgeted = targets.reduce((sum,b)=>
      sum+Math.max(0,actualMap.get(b.category)||0),0);
    const remaining = planned - spent;
    const coverage = positiveActual > 0 ? positiveBudgeted / positiveActual * 100 : 0;

    setText("budget-planned-total", `¥${formatMoney(planned)}`);
    setText("budget-spent-total", `${spent<0?"−":""}¥${formatMoney(Math.abs(spent))}`);
    setText("budget-remaining-total", `${remaining < 0 ? "−" : ""}¥${formatMoney(Math.abs(remaining))}`);
    setText("budget-coverage", `${coverage.toFixed(0)}%`);
    setText("budget-month-title", monthLabel(selectedMonth));

    const remainingEl = document.getElementById("budget-remaining-total");
    remainingEl?.classList.toggle("budget-negative", remaining < 0);

    const scopeEl = document.getElementById("budget-actual-scope");
    if (scopeEl) {
      scopeEl.textContent = selectedMonth === currentMonthTokyo()
        ? `Posted through ${todayTokyo()}`
        : selectedMonth > currentMonthTokyo()
          ? "Future month · no actual spending yet"
          : "Full recorded month";
    }
  }

  function renderBudgetRows() {
    const list = document.getElementById("budget-target-list");
    const actualMap = actualByCategory(selectedMonth);
    const rows = selectedBudgets();
    if (!list) return;
    list.replaceChildren();

    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "budget-empty";
      empty.textContent = "No targets saved for this month. Add a category below or use one of the historical suggestions.";
      list.appendChild(empty);
      return;
    }

    rows.forEach(budget => {
      const target = amount(budget.amount);
      const spent = actualMap.get(budget.category) || 0;
      const remaining = target - spent;
      const ratio = target > 0 ? Math.max(0,spent) / target : 0;

      const card = document.createElement("article");
      card.className = "budget-row";

      const top = document.createElement("div");
      top.className = "budget-row-top";

      const copy = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = budget.category;
      const meta = document.createElement("span");
      meta.textContent = `Net spent ${spent<0?"−":""}¥${formatMoney(Math.abs(spent))} · ${remaining >= 0 ? "Remaining" : "Over"} ¥${formatMoney(Math.abs(remaining))}`;
      copy.append(title, meta);

      const percent = document.createElement("span");
      percent.className = ratio > 1 ? "budget-percent over" : ratio >= .8 ? "budget-percent warning" : "budget-percent";
      percent.textContent = `${Math.round(ratio * 100)}%`;
      top.append(copy, percent);

      const progress = document.createElement("div");
      progress.className = "budget-progress";
      const fill = document.createElement("span");
      setProgress(fill, ratio);
      progress.appendChild(fill);

      const actions = document.createElement("div");
      actions.className = "budget-row-actions";

      const inputWrap = document.createElement("label");
      inputWrap.className = "budget-inline-input";
      const yen = document.createElement("span");
      yen.textContent = "¥";
      const input = document.createElement("input");
      input.type = "number";
      input.min = "1";
      input.step = "100";
      input.value = String(Math.round(target));
      input.dataset.budgetAmount = String(budget.id);
      inputWrap.append(yen, input);

      const save = document.createElement("button");
      save.type = "button";
      save.className = "budget-save-small";
      save.dataset.budgetSave = String(budget.id);
      save.dataset.category = budget.category;
      save.textContent = "Update";

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "budget-remove-small";
      remove.dataset.budgetRemove = String(budget.id);
      remove.dataset.category = budget.category;
      remove.textContent = "Remove";

      actions.append(inputWrap, save, remove);
      card.append(top, progress, actions);
      list.appendChild(card);
    });
  }

  function renderSuggestions() {
    const list = document.getElementById("budget-suggestion-list");
    if (!list) return;
    list.replaceChildren();

    const saved = new Set(selectedBudgets().map(b => b.category));
    const suggestions = historicalSuggestions(selectedMonth)
      .filter(row => !saved.has(row.category))
      .slice(0, 8);

    if (!suggestions.length) {
      const empty = document.createElement("div");
      empty.className = "budget-empty";
      empty.textContent = "No additional 3-month suggestions are available.";
      list.appendChild(empty);
      return;
    }

    suggestions.forEach(row => {
      const card = document.createElement("article");
      card.className = "budget-suggestion";

      const copy = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = row.category;
      const meta = document.createElement("span");
      meta.textContent = `3-month calendar average · active in ${row.activeMonths}/3 months`;
      copy.append(title, meta);

      const right = document.createElement("div");
      const suggested = document.createElement("strong");
      suggested.textContent = `¥${formatMoney(row.suggested)}`;
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.useSuggestion = row.category;
      button.dataset.suggestedAmount = String(Math.round(row.suggested / 100) * 100 || Math.round(row.suggested));
      button.textContent = "Use";
      right.append(suggested, button);

      card.append(copy, right);
      list.appendChild(card);
    });
  }

  function populateCategoryOptions() {
    const select = document.getElementById("budget-category");
    if (!select) return;
    const previous = select.value;
    const categories = [...new Set(
      cash.filter(isExpense).map(categoryOf).filter(category => category.toLowerCase() !== "others")
    )].sort((a, b) => a.localeCompare(b));

    select.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Choose category";
    select.appendChild(placeholder);

    categories.forEach(category => {
      const option = document.createElement("option");
      option.value = category;
      option.textContent = category;
      select.appendChild(option);
    });
    if (categories.includes(previous)) select.value = previous;
  }

  function updateSuggestionHint() {
    const category = document.getElementById("budget-category")?.value;
    const hint = document.getElementById("budget-suggestion-hint");
    if (!hint) return;
    if (!category) {
      hint.textContent = "Choose a category to see its recent-history suggestion.";
      return;
    }
    const row = historicalSuggestions(selectedMonth).find(item => item.category === category);
    hint.textContent = row
      ? `3-month calendar average: ¥${formatMoney(row.suggested)} · active in ${row.activeMonths}/3 months`
      : "No spending history in the previous 3 calendar months.";
  }

  function render() {
    if (!selectedMonth) selectedMonth = currentMonthTokyo();
    const picker = document.getElementById("budget-month");
    if (picker && picker.value !== selectedMonth) picker.value = selectedMonth;
    populateCategoryOptions();
    updateSuggestionHint();
    renderSummary();
    renderBudgetRows();
    renderSuggestions();
  }

  async function saveTarget({ id = null, category, value }) {
    const numeric = Number(value);
    if (!category) throw new Error("Choose a category first.");
    if (!Number.isFinite(numeric) || numeric <= 0) throw new Error("Budget amount must be greater than zero.");

    const result = await window.BudgetCloud.saveMonthlyBudget({
      month: selectedMonth,
      category,
      amount: numeric
    });
    if (!result?.success) throw new Error(result?.error || "Budget target could not be saved.");
    window.dispatchEvent(new CustomEvent("budget:plan-changed", {
      detail: { action: id ? "updated" : "created", category }
    }));
  }

  async function removeTarget(id, category) {
    const result = await window.BudgetCloud.removeMonthlyBudget(id);
    if (!result?.success) throw new Error(result?.error || "Budget target could not be removed.");
    window.dispatchEvent(new CustomEvent("budget:plan-changed", {
      detail: { action: "removed", category }
    }));
  }

  function setBusy(button, busy, label) {
    if (!button) return;
    if (busy) {
      button.dataset.oldText = button.textContent;
      button.disabled = true;
      button.textContent = label;
    } else {
      button.disabled = false;
      button.textContent = button.dataset.oldText || button.textContent;
    }
  }

  function init() {
    selectedMonth = currentMonthTokyo();

    document.getElementById("budget-month")?.addEventListener("change", event => {
      selectedMonth = event.target.value || currentMonthTokyo();
      render();
    });

    document.getElementById("budget-category")?.addEventListener("change", updateSuggestionHint);

    document.getElementById("budget-add-form")?.addEventListener("submit", async event => {
      event.preventDefault();
      const button = document.getElementById("budget-add-save");
      const category = document.getElementById("budget-category")?.value;
      const input = document.getElementById("budget-amount");
      try {
        setBusy(button, true, "Saving…");
        await saveTarget({ category, value: input?.value });
        if (input) input.value = "";
      } catch (error) {
        window.dispatchEvent(new CustomEvent("budget:planner-error", {
          detail: { message: error?.message || "Budget target could not be saved." }
        }));
      } finally {
        setBusy(button, false);
      }
    });

    document.getElementById("budget-target-list")?.addEventListener("click", async event => {
      const save = event.target.closest("[data-budget-save]");
      const remove = event.target.closest("[data-budget-remove]");

      if (save) {
        const id = save.dataset.budgetSave;
        const input = document.querySelector(`[data-budget-amount="${id}"]`);
        try {
          setBusy(save, true, "Saving…");
          await saveTarget({ id, category: save.dataset.category, value: input?.value });
        } catch (error) {
          window.dispatchEvent(new CustomEvent("budget:planner-error", {
            detail: { message: error?.message || "Budget target could not be updated." }
          }));
        } finally {
          setBusy(save, false);
        }
      }

      if (remove) {
        try {
          setBusy(remove, true, "Removing…");
          await removeTarget(remove.dataset.budgetRemove, remove.dataset.category);
        } catch (error) {
          window.dispatchEvent(new CustomEvent("budget:planner-error", {
            detail: { message: error?.message || "Budget target could not be removed." }
          }));
        } finally {
          setBusy(remove, false);
        }
      }
    });

    document.getElementById("budget-suggestion-list")?.addEventListener("click", event => {
      const button = event.target.closest("[data-use-suggestion]");
      if (!button) return;
      const select = document.getElementById("budget-category");
      const input = document.getElementById("budget-amount");
      if (select) select.value = button.dataset.useSuggestion || "";
      if (input) input.value = button.dataset.suggestedAmount || "";
      updateSuggestionHint();
      input?.focus();
    });

    render();
  }

  function setData(next = {}) {
    cash = Array.isArray(next.cash) ? next.cash : [];
    budgets = Array.isArray(next.budgets) ? next.budgets : [];
    render();
  }

  function getSummary(month = currentMonthTokyo()) {
    const actualMap = actualByCategory(month);
    const targets = budgets.filter(b => String(b.month_start || "").slice(0, 7) === month);
    const details = targets.map(b => {
      const target = amount(b.amount);
      const spent = actualMap.get(b.category) || 0;
      const ratio = target > 0 ? Math.max(0,spent) / target : 0;
      return {
        category: b.category,
        target,
        spent,
        remaining: target - spent,
        ratio
      };
    }).sort((a, b) => b.ratio - a.ratio);

    return {
      month,
      targetCount: targets.length,
      planned: details.reduce((sum, row) => sum + row.target, 0),
      spent: details.reduce((sum, row) => sum + row.spent, 0),
      over: details.filter(row => row.ratio > 1),
      near: details.filter(row => row.ratio >= .8 && row.ratio <= 1),
      details
    };
  }

  window.MonthlyBudget = {
    init,
    setData,
    render,
    getSummary
  };
})();