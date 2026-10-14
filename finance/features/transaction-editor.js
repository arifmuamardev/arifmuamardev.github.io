(() => {
  "use strict";

  const state = {
    current: null,
    rows: [],
    latestCashId: null
  };

  function tokyoDateString() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date());
    const map = Object.fromEntries(parts.filter(p => p.type !== "literal").map(p => [p.type, p.value]));
    return `${map.year}-${map.month}-${map.day}`;
  }

  function inferFlow(item) {
    const income = Number(item?.pemasukan) || 0;
    const expense = Number(item?.pengeluaran) || 0;
    if (income > 0) return "income";
    if (expense < 0) return "refund";
    return "expense";
  }

  function inferAmount(item) {
    const income = Number(item?.pemasukan) || 0;
    const expense = Number(item?.pengeluaran) || 0;
    return income > 0 ? income : Math.abs(expense);
  }

  function buildModal() {
    if (document.getElementById("transaction-editor-backdrop")) return;

    const wrapper = document.createElement("div");
    wrapper.innerHTML = `
      <div id="transaction-editor-backdrop" class="transaction-editor-backdrop hidden" aria-hidden="true">
        <section id="transaction-editor" class="transaction-editor" role="dialog" aria-modal="true" aria-labelledby="transaction-editor-title">
          <div class="transaction-editor-header">
            <div>
              <span class="home-section-kicker" id="transaction-editor-kicker">Manual ledger entry</span>
              <h2 id="transaction-editor-title">Add transaction</h2>
              <p id="transaction-editor-subtitle">Save one owner-only ledger record.</p>
            </div>
            <button type="button" class="transaction-editor-close" id="transaction-editor-close" aria-label="Close editor">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>

          <form id="transaction-editor-form" class="transaction-editor-form" novalidate>
            <input type="hidden" id="transaction-editor-id">

            <div id="transaction-editor-guard" class="transaction-editor-guard hidden">
              <i class="fa-solid fa-shield-halved"></i>
              <span>For older cash records, financial fields are locked to protect later running balances. Metadata can still be corrected.</span>
            </div>

            <div class="transaction-editor-grid">
              <label class="transaction-editor-field">
                <span>Date</span>
                <input type="date" id="transaction-editor-date" required>
              </label>

              <label class="transaction-editor-field">
                <span>Flow</span>
                <select id="transaction-editor-flow" required>
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                  <option value="refund">Refund / credit</option>
                </select>
              </label>

              <label class="transaction-editor-field transaction-editor-field-wide">
                <span>Description</span>
                <input type="text" id="transaction-editor-item" maxlength="180" placeholder="e.g. Groceries at Aeon" required>
              </label>

              <label class="transaction-editor-field">
                <span>Amount (JPY)</span>
                <input type="number" id="transaction-editor-amount" min="0.01" step="0.01" inputmode="decimal" placeholder="0" required>
              </label>

              <label class="transaction-editor-field">
                <span>Payment</span>
                <select id="transaction-editor-payment" required>
                  <option value="cashless">Digital / cashless</option>
                  <option value="cash">Cash</option>
                </select>
              </label>

              <label class="transaction-editor-field">
                <span>Category</span>
                <input type="text" id="transaction-editor-category" list="transaction-editor-categories" maxlength="120" placeholder="Choose a category (required)">
                <datalist id="transaction-editor-categories"></datalist>
                <span id="transaction-editor-category-suggestion" class="transaction-editor-category-suggestion hidden"></span>
                <button type="button" id="transaction-editor-apply-category" class="transaction-editor-apply-category hidden">Use suggestion</button>
              </label>

              <label class="transaction-editor-field">
                <span>Store / location</span>
                <input type="text" id="transaction-editor-store" maxlength="160" placeholder="Optional">
              </label>

              <label class="transaction-editor-field transaction-editor-field-wide">
                <span>Note</span>
                <textarea id="transaction-editor-note" rows="3" maxlength="500" placeholder="Optional note"></textarea>
              </label>
            </div>

            <div id="transaction-editor-message" class="transaction-editor-message hidden" aria-live="polite"></div>

            <div class="transaction-editor-safety">
              <i class="fa-solid fa-circle-info"></i>
              <span>Delete is disabled. New cash entries must not be backdated before the latest cash-balance record; the database enforces this rule.</span>
            </div>

            <div class="transaction-editor-actions">
              <button type="button" class="transaction-editor-cancel" id="transaction-editor-cancel">Cancel</button>
              <button type="submit" class="transaction-editor-save" id="transaction-editor-save">
                <i class="fa-solid fa-floppy-disk"></i>
                Save transaction
              </button>
            </div>
          </form>
        </section>
      </div>
    `;
    document.body.appendChild(wrapper.firstElementChild);

    document.getElementById("transaction-editor-close")?.addEventListener("click", close);
    document.getElementById("transaction-editor-cancel")?.addEventListener("click", close);
    document.getElementById("transaction-editor-backdrop")?.addEventListener("click", event => {
      if (event.target?.id === "transaction-editor-backdrop") close();
    });
    document.getElementById("transaction-editor-form")?.addEventListener("submit", submit);
    ["transaction-editor-item","transaction-editor-store","transaction-editor-note",
     "transaction-editor-flow","transaction-editor-category"].forEach(id => {
      document.getElementById(id)?.addEventListener("input", updateCategorySuggestion);
      document.getElementById(id)?.addEventListener("change", updateCategorySuggestion);
    });
    document.getElementById("transaction-editor-apply-category")?.addEventListener("click", () => {
      const suggestion=readCategorySuggestion();
      if (!suggestion) return;
      const field=document.getElementById("transaction-editor-category");
      if(field)field.value=suggestion.category;
      updateCategorySuggestion();
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && isOpen()) close();
    });
  }

  function isOpen() {
    return !document.getElementById("transaction-editor-backdrop")?.classList.contains("hidden");
  }

  function setMessage(message = "", type = "error") {
    const el = document.getElementById("transaction-editor-message");
    if (!el) return;
    el.textContent = message;
    el.classList.toggle("hidden", !message);
    el.dataset.type = type;
  }

  function readCategorySuggestion() {
    return window.FinanceCategoryStandards?.suggest({
      item:document.getElementById("transaction-editor-item")?.value || "",
      store:document.getElementById("transaction-editor-store")?.value || "",
      flow:document.getElementById("transaction-editor-flow")?.value || "expense",
      note:document.getElementById("transaction-editor-note")?.value || ""
    }) || null;
  }

  function updateCategorySuggestion() {
    const category=document.getElementById("transaction-editor-category")?.value?.trim() || "";
    const suggestion=readCategorySuggestion();
    const hint=document.getElementById("transaction-editor-category-suggestion");
    const button=document.getElementById("transaction-editor-apply-category");
    if(hint) {
      hint.classList.toggle("hidden",!suggestion);
      hint.textContent=suggestion
        ? "Suggestion: "+suggestion.category+". "+suggestion.reason+" Confirm before saving."
        : "";
    }
    if(button)button.classList.toggle("hidden", !suggestion || suggestion.category===category);
  }

  function setRows(rows = []) {
    state.rows = Array.isArray(rows) ? rows : [];

    const latestCash = state.rows
      .filter(item =>
        item?.payment_type === "cash" &&
        item?.saldo !== null &&
        item?.saldo !== undefined
      )
      .sort((a, b) =>
        String(b.tanggal || "").localeCompare(String(a.tanggal || "")) ||
        Number(b.id || 0) - Number(a.id || 0)
      )[0];

    state.latestCashId = latestCash ? Number(latestCash.id) : null;

    const categories = [...new Set([
      ...(window.FinanceCategoryStandards?.categories || []),
      ...state.rows
        .map(item => item?.kategori_normalized || item?.kategori)
        .filter(Boolean)
        .map(value => String(value).trim())
        .filter(Boolean)
    ])].sort((a, b) => a.localeCompare(b));

    const list = document.getElementById("transaction-editor-categories");
    if (list) {
      list.replaceChildren(...categories.map(category => {
        const option = document.createElement("option");
        option.value = category;
        return option;
      }));
    }
  }

  function setFinancialFieldsLocked(locked) {
    ["transaction-editor-date", "transaction-editor-flow", "transaction-editor-amount", "transaction-editor-payment"]
      .forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = locked;
      });
    document.getElementById("transaction-editor-guard")?.classList.toggle("hidden", !locked);
  }

  function openBase({ mode, item = null, overrides = {} }) {
    buildModal();
    state.current = item;

    const backdrop = document.getElementById("transaction-editor-backdrop");
    const title = document.getElementById("transaction-editor-title");
    const subtitle = document.getElementById("transaction-editor-subtitle");
    const kicker = document.getElementById("transaction-editor-kicker");
    const save = document.getElementById("transaction-editor-save");
    const form = document.getElementById("transaction-editor-form");

    form?.reset();
    setMessage();

    const editing = mode === "edit" && item;
    if (title) title.textContent = editing ? "Edit transaction" : "Add transaction";
    if (kicker) kicker.textContent = editing ? "Owner-only correction" : "Manual ledger entry";
    if (subtitle) subtitle.textContent = editing
      ? overrides.category
        ? `Review the suggested category “${overrides.category}” before saving.`
        : "Update this ledger record without exposing delete controls."
      : "Save one new transaction to your private ledger.";
    if (save) save.innerHTML = editing
      ? '<i class="fa-solid fa-floppy-disk"></i> Save changes'
      : '<i class="fa-solid fa-plus"></i> Add transaction';

    const idEl = document.getElementById("transaction-editor-id");
    const dateEl = document.getElementById("transaction-editor-date");
    const flowEl = document.getElementById("transaction-editor-flow");
    const itemEl = document.getElementById("transaction-editor-item");
    const amountEl = document.getElementById("transaction-editor-amount");
    const paymentEl = document.getElementById("transaction-editor-payment");
    const categoryEl = document.getElementById("transaction-editor-category");
    const storeEl = document.getElementById("transaction-editor-store");
    const noteEl = document.getElementById("transaction-editor-note");

    if (idEl) idEl.value = editing ? String(item.id ?? "") : "";
    if (dateEl) dateEl.value = editing ? String(item.tanggal || "").slice(0, 10) : tokyoDateString();
    if (flowEl) flowEl.value = editing ? inferFlow(item) : "expense";
    if (itemEl) itemEl.value = editing ? String(item.item_normalized || item.item || "") : "";
    if (amountEl) amountEl.value = editing ? String(inferAmount(item) || "") : "";
    if (paymentEl) paymentEl.value = editing ? (item.payment_type === "cash" ? "cash" : "cashless") : "cashless";
    if (categoryEl) categoryEl.value = editing
      ? String(overrides.category || item.kategori_normalized || item.kategori || "Others")
      : String(overrides.category || "");
    if (storeEl) storeEl.value = editing ? String(item.tempat || "") : "";
    if (noteEl) noteEl.value = editing ? String(item.note || "") : "";
    updateCategorySuggestion();

    const olderCash = Boolean(
      editing &&
      item.payment_type === "cash" &&
      state.latestCashId !== null &&
      Number(item.id) !== state.latestCashId
    );
    setFinancialFieldsLocked(olderCash);

    backdrop?.classList.remove("hidden");
    backdrop?.setAttribute("aria-hidden", "false");
    window.setTimeout(() => itemEl?.focus(), 0);
  }

  function openAdd() {
    openBase({ mode: "add" });
  }

  function openEdit(item, overrides = {}) {
    if (!item) return;
    openBase({ mode: "edit", item, overrides });
  }

  function close() {
    const backdrop = document.getElementById("transaction-editor-backdrop");
    backdrop?.classList.add("hidden");
    backdrop?.setAttribute("aria-hidden", "true");
    setMessage();
  }

  async function submit(event) {
    event.preventDefault();

    const form = event.currentTarget;
    const save = document.getElementById("transaction-editor-save");
    const original = save?.innerHTML;

    const date = document.getElementById("transaction-editor-date")?.value;
    const flow = document.getElementById("transaction-editor-flow")?.value;
    const item = document.getElementById("transaction-editor-item")?.value?.trim();
    const amount = Number(document.getElementById("transaction-editor-amount")?.value);
    const paymentType = document.getElementById("transaction-editor-payment")?.value;
    const category = document.getElementById("transaction-editor-category")?.value?.trim() || "";
    const store = document.getElementById("transaction-editor-store")?.value?.trim() || "";
    const note = document.getElementById("transaction-editor-note")?.value?.trim() || "";
    const idRaw = document.getElementById("transaction-editor-id")?.value;
    const id = idRaw ? Number(idRaw) : null;

    if (!date || !item || !Number.isFinite(amount) || amount <= 0) {
      setMessage("Date, description, and an amount greater than zero are required.");
      return;
    }

    if (!category) {
      setMessage("Choose a category explicitly. Use a suggestion or select Others when the item truly cannot be identified.");
      return;
    }
    if (!["income", "expense", "refund"].includes(flow)) {
      setMessage("Choose a valid transaction flow.");
      return;
    }
    if (!["cash", "cashless"].includes(paymentType)) {
      setMessage("Choose cash or digital payment.");
      return;
    }

    try {
      setMessage();
      if (save) {
        save.disabled = true;
        save.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…';
      }

      const result = await window.BudgetCloud.saveTransaction({
        id,
        date,
        item,
        category,
        store,
        flow,
        amount,
        paymentType,
        note
      });

      if (!result?.success) throw new Error(result?.error || "Transaction could not be saved.");

      close();
      window.dispatchEvent(new CustomEvent("budget:transaction-saved", {
        detail: {
          mode: result.mode || (id ? "updated" : "created"),
          transaction: result.transaction || null
        }
      }));
    } catch (error) {
      console.error("Transaction save failed:", error);
      setMessage(error?.message || "Transaction could not be saved.");
    } finally {
      if (save) {
        save.disabled = false;
        save.innerHTML = original || '<i class="fa-solid fa-floppy-disk"></i> Save transaction';
      }
    }
  }

  function init() {
    buildModal();
    document.getElementById("transaction-add-btn")?.addEventListener("click", openAdd);
    document.getElementById("transaction-edit-btn")?.addEventListener("click", () => {
      if (state.current) openEdit(state.current);
    });
  }

  function setCurrent(item) {
    state.current = item || null;
  }

  window.TransactionEditor = {
    init,
    setRows,
    setCurrent,
    openAdd,
    openEdit,
    close
  };
})();