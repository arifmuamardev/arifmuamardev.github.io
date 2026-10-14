(() => {
  "use strict";

  const FIELD_LABELS = {
    tanggal: "Date",
    item_normalized: "Description",
    kategori_normalized: "Category",
    tempat: "Store",
    pemasukan: "Income",
    pengeluaran: "Expense",
    payment_type: "Payment",
    note: "Note"
  };

  function todayTokyo() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date());
    const map = Object.fromEntries(parts.filter(p => p.type !== "literal").map(p => [p.type, p.value]));
    return `${map.year}-${map.month}-${map.day}`;
  }

  function isScheduled(item) {
    return String(item?.tanggal || "").slice(0, 10) > todayTokyo();
  }

  function formatValue(key, value) {
    if (value === null || value === undefined || value === "") return "—";
    if (["pemasukan", "pengeluaran"].includes(key)) {
      const n = Number(value);
      return Number.isFinite(n) ? `¥${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}` : String(value);
    }
    if (key === "payment_type") return value === "cashless" ? "Digital" : value === "cash" ? "Cash" : String(value);
    return String(value);
  }

  function buildChanges(entry) {
    if (entry.action !== "update") return [];
    const oldRow = entry.old_row || {};
    const newRow = entry.new_row || {};
    return Object.keys(FIELD_LABELS)
      .filter(key => String(oldRow[key] ?? "") !== String(newRow[key] ?? ""))
      .map(key => ({
        label: FIELD_LABELS[key],
        before: formatValue(key, oldRow[key]),
        after: formatValue(key, newRow[key])
      }));
  }

  function setStatus(item) {
    const badge = document.getElementById("transaction-detail-status");
    if (!badge) return;
    const scheduled = isScheduled(item);
    badge.textContent = scheduled ? "Scheduled" : "Posted";
    badge.className = `transaction-status-badge ${scheduled ? "scheduled" : "posted"}`;
  }

  function renderEmpty(message) {
    const list = document.getElementById("transaction-history-list");
    if (!list) return;
    list.replaceChildren();
    const empty = document.createElement("div");
    empty.className = "transaction-history-empty";
    empty.textContent = message;
    list.appendChild(empty);
  }

  function renderEntries(entries) {
    const list = document.getElementById("transaction-history-list");
    if (!list) return;
    list.replaceChildren();

    if (!entries.length) {
      renderEmpty("No audit events recorded yet. Audit history starts from v4.5 changes.");
      return;
    }

    entries.forEach(entry => {
      const article = document.createElement("article");
      article.className = "transaction-history-entry";

      const icon = document.createElement("span");
      icon.className = "transaction-history-icon";
      const i = document.createElement("i");
      i.className = entry.action === "insert" ? "fa-solid fa-plus" : "fa-solid fa-pen";
      icon.appendChild(i);

      const content = document.createElement("div");
      content.className = "transaction-history-content";

      const head = document.createElement("div");
      head.className = "transaction-history-head";

      const title = document.createElement("strong");
      title.textContent = entry.action === "insert" ? "Transaction created" : "Transaction updated";

      const time = document.createElement("time");
      const dt = new Date(entry.changed_at);
      time.textContent = Number.isNaN(dt.getTime())
        ? String(entry.changed_at || "")
        : new Intl.DateTimeFormat("en", {
            timeZone: "Asia/Tokyo",
            dateStyle: "medium",
            timeStyle: "short"
          }).format(dt);

      head.append(title, time);
      content.appendChild(head);

      const changes = buildChanges(entry);
      if (changes.length) {
        const changesWrap = document.createElement("div");
        changesWrap.className = "transaction-history-changes";
        changes.forEach(change => {
          const row = document.createElement("div");
          const label = document.createElement("span");
          label.textContent = change.label;
          const values = document.createElement("div");
          const before = document.createElement("del");
          before.textContent = change.before;
          const arrow = document.createElement("span");
          arrow.textContent = "→";
          const after = document.createElement("ins");
          after.textContent = change.after;
          values.append(before, arrow, after);
          row.append(label, values);
          changesWrap.appendChild(row);
        });
        content.appendChild(changesWrap);
      }

      article.append(icon, content);
      list.appendChild(article);
    });
  }

  async function render(item) {
    setStatus(item);
    const list = document.getElementById("transaction-history-list");
    if (!list || !item?.id) return;

    renderEmpty("Loading audit history…");
    try {
      const entries = await window.BudgetCloud.getTransactionHistory(item.id);
      renderEntries(entries);
    } catch (error) {
      console.error("Transaction history failed:", error);
      renderEmpty("Audit history could not be loaded.");
    }
  }

  window.TransactionHistory = {
    render,
    isScheduled,
    todayTokyo
  };
})();