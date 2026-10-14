(() => {
  "use strict";

  let payload = {
    cash: [],
    withdrawals: [],
    bni: [],
    muamalat: [],
    gopay: [],
    audit: [],
    settings: {}
  };

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

  function isScheduled(item) {
    return String(item?.tanggal || "").slice(0, 10) > todayTokyo();
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("ja-JP").format(Number(value) || 0);
  }

  function getSignature(item) {
    return [
      String(item?.tanggal || "").slice(0, 10),
      String(item?.item_normalized || item?.item || "").trim().toLowerCase(),
      String(item?.kategori_normalized || item?.kategori || "").trim().toLowerCase(),
      String(item?.tempat || "").trim().toLowerCase(),
      Number(item?.pemasukan || 0).toFixed(2),
      Number(item?.pengeluaran || 0).toFixed(2),
      String(item?.payment_type || "")
    ].join("|");
  }

  function analyze() {
    const cash = payload.cash || [];
    const posted = cash.filter(item => !isScheduled(item));
    const scheduled = cash.filter(isScheduled);

    const signatureMap = new Map();
    posted.forEach(item => {
      const signature = getSignature(item);
      if (!signatureMap.has(signature)) signatureMap.set(signature, []);
      signatureMap.get(signature).push(item);
    });
    const duplicateGroups = [...signatureMap.values()].filter(group => group.length > 1);
    const possibleDuplicateRows = duplicateGroups.reduce((sum, group) => sum + group.length, 0);

    const missingEssentials = cash.filter(item =>
      !String(item?.tanggal || "").trim() ||
      !String(item?.item_normalized || item?.item || "").trim() ||
      !String(item?.kategori_normalized || item?.kategori || "").trim() ||
      !["cash","cashless"].includes(String(item?.payment_type || ""))
    );

    const cashBalanceGaps = cash.filter(item =>
      item?.payment_type === "cash" &&
      item?.saldo === null
    );
    const foreignCashBalanceGaps = cashBalanceGaps.filter(item =>
      /\bRp\b/i.test(String(item?.note || ""))
    );
    const unexplainedCashBalanceGaps = cashBalanceGaps.filter(item =>
      !/\bRp\b/i.test(String(item?.note || ""))
    );

    const othersRows = cash.filter(item =>
      String(item?.kategori_normalized || item?.kategori || "").trim().toLowerCase() === "others"
    );

    const postedDates = posted
      .map(item => String(item?.tanggal || "").slice(0, 10))
      .filter(Boolean)
      .sort();
    const latestPosted = postedDates.at(-1) || null;
    const earliestPosted = postedDates[0] || null;

    const connectedRows =
      cash.length +
      (payload.withdrawals || []).length +
      (payload.bni || []).length +
      (payload.muamalat || []).length +
      (payload.gopay || []).length;

    return {
      posted,
      scheduled,
      duplicateGroups,
      possibleDuplicateRows,
      missingEssentials,
      cashBalanceGaps,
      foreignCashBalanceGaps,
      unexplainedCashBalanceGaps,
      othersRows,
      latestPosted,
      earliestPosted,
      connectedRows
    };
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value);
  }

  function renderChecks(a) {
    const list = document.getElementById("data-quality-checks");
    if (!list) return;
    list.replaceChildren();

    const checks = [
      {
        tone: a.missingEssentials.length ? "warning" : "good",
        icon: a.missingEssentials.length ? "fa-triangle-exclamation" : "fa-circle-check",
        title: "Essential fields",
        detail: a.missingEssentials.length
          ? `${a.missingEssentials.length} row(s) need date, description, category, or payment type review.`
          : "All ledger rows have the essential fields used by this dashboard."
      },
      {
        tone: a.unexplainedCashBalanceGaps.length ? "warning" : a.foreignCashBalanceGaps.length ? "info" : "good",
        icon: a.unexplainedCashBalanceGaps.length ? "fa-scale-unbalanced-flip" : a.foreignCashBalanceGaps.length ? "fa-earth-asia" : "fa-circle-check",
        title: "Cash rows without JPY running balance",
        detail: a.unexplainedCashBalanceGaps.length
          ? `${a.unexplainedCashBalanceGaps.length} row(s) need review; ${a.foreignCashBalanceGaps.length} additional row(s) are recognized as Rupiah cash records.`
          : a.foreignCashBalanceGaps.length
            ? `${a.foreignCashBalanceGaps.length} row(s) are legacy Rupiah cash transactions and intentionally have no JPY running balance.`
            : "Cash rows that participate in the JPY wallet ledger have running-balance values."
      },
      {
        tone: a.duplicateGroups.length ? "review" : "good",
        icon: a.duplicateGroups.length ? "fa-clone" : "fa-circle-check",
        title: "Possible duplicate records",
        detail: a.duplicateGroups.length
          ? `${a.duplicateGroups.length} exact signature group(s), covering ${a.possibleDuplicateRows} rows. These are review candidates, not automatic errors.`
          : "No exact duplicate signatures detected in posted transactions."
      },
      {
        tone: a.scheduled.length ? "info" : "good",
        icon: a.scheduled.length ? "fa-calendar-clock" : "fa-circle-check",
        title: "Future-dated records",
        detail: a.scheduled.length
          ? `${a.scheduled.length} row(s) are scheduled after today and excluded from actual-spending analytics.`
          : "No future-dated ledger rows are present."
      },
      {
        tone: a.othersRows.length ? "review" : "good",
        icon: a.othersRows.length ? "fa-tags" : "fa-circle-check",
        title: "Unclassified category",
        detail: a.othersRows.length
          ? `${a.othersRows.length} row(s) use “Others”. Reclassification is optional but can improve category analytics.`
          : "No rows currently use the generic “Others” category."
      }
    ];

    checks.forEach(check => {
      const article = document.createElement("article");
      article.className = `data-check ${check.tone}`;

      const icon = document.createElement("span");
      icon.className = "data-check-icon";
      const i = document.createElement("i");
      i.className = `fa-solid ${check.icon}`;
      icon.appendChild(i);

      const body = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = check.title;
      const detail = document.createElement("p");
      detail.textContent = check.detail;
      body.append(title, detail);

      article.append(icon, body);
      list.appendChild(article);
    });
  }

  function render() {
    const a = analyze();

    setText("data-total-rows", formatNumber(a.connectedRows));
    setText("data-posted-count", formatNumber(a.posted.length));
    setText("data-scheduled-count", formatNumber(a.scheduled.length));
    setText("data-duplicate-count", formatNumber(a.duplicateGroups.length));
    setText("data-missing-count", formatNumber(a.missingEssentials.length));
    setText("data-others-count", formatNumber(a.othersRows.length));
    setText("data-audit-count", formatNumber((payload.audit || []).length));
    setText("data-range", a.earliestPosted && a.latestPosted ? `${a.earliestPosted} → ${a.latestPosted}` : "—");
    setText("data-latest-posted", a.latestPosted || "—");

    const lastBackup = localStorage.getItem("finance-last-local-backup");
    setText("data-last-backup", lastBackup || "No local export recorded yet");

    renderChecks(a);
  }

  function safeCsvCell(value) {
    let text = value === null || value === undefined ? "" : String(value);
    const isPlainNumber = /^-?\d+(?:\.\d+)?$/.test(text.trim());
    if (!isPlainNumber && /^[=+\-@]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  }

  function downloadBlob(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);

    const stamped = new Intl.DateTimeFormat("en", {
      timeZone: "Asia/Tokyo",
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date());
    localStorage.setItem("finance-last-local-backup", stamped);
    setText("data-last-backup", stamped);
  }

  function exportJson() {
    const exportedAt = new Date().toISOString();
    const backup = {
      backup_format: "personal-finance-neon",
      backup_version: 1,
      exported_at: exportedAt,
      timezone: payload.settings?.timezone || "Asia/Tokyo",
      note: "Browser-generated owner backup. Contains private financial data; store securely.",
      datasets: {
        cash_transactions: payload.cash || [],
        atm_transactions: payload.withdrawals || [],
        bni_transactions: payload.bni || [],
        muamalat_transactions: payload.muamalat || [],
        gopay_transactions: payload.gopay || [],
        cash_transaction_audit: payload.audit || []
      },
      app_settings: payload.settings || {}
    };
    downloadBlob(
      `personal-finance-backup-${todayTokyo()}.json`,
      JSON.stringify(backup, null, 2),
      "application/json;charset=utf-8"
    );
  }

  function exportCashCsv() {
    const columns = [
      "id","tanggal","item_normalized","item","kategori_normalized","kategori","tempat",
      "pemasukan","pengeluaran","saldo","payment_type","note","currency","updated_at"
    ];
    const rows = [columns.map(safeCsvCell).join(",")];
    (payload.cash || []).forEach(item => {
      rows.push(columns.map(column => safeCsvCell(item?.[column])).join(","));
    });
    downloadBlob(
      `cash-ledger-${todayTokyo()}.csv`,
      "\uFEFF" + rows.join("\r\n"),
      "text/csv;charset=utf-8"
    );
  }

  function setData(nextPayload) {
    payload = {
      cash: nextPayload?.cash || [],
      withdrawals: nextPayload?.withdrawals || [],
      bni: nextPayload?.bni || [],
      muamalat: nextPayload?.muamalat || [],
      gopay: nextPayload?.gopay || [],
      audit: nextPayload?.audit || [],
      settings: nextPayload?.settings || {}
    };
    render();
  }

  function init() {
    document.getElementById("data-export-json")?.addEventListener("click", exportJson);
    document.getElementById("data-export-csv")?.addEventListener("click", exportCashCsv);
    document.getElementById("data-refresh-checks")?.addEventListener("click", render);
    render();
  }

  window.DataTools = {
    init,
    setData,
    render
  };
})();