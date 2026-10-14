/* ----------------------------------------------------
   Cloud data + authentication adapter (Neon)
   Managed Better Auth + Neon Data API via neon-js.
   ---------------------------------------------------- */
import { createClient } from "https://cdn.jsdelivr.net/npm/@neondatabase/neon-js@0.7.0-beta/+esm";

(() => {
  "use strict";

  const cfg = window.BUDGET_CLOUD_CONFIG || {};
  let client = null;
  const PAGE_SIZE = 1000;

  function isConfigured() {
    return Boolean(
      cfg.neonAuthUrl &&
      cfg.neonDataApiUrl &&
      /^https:\/\//i.test(cfg.neonAuthUrl) &&
      /^https:\/\//i.test(cfg.neonDataApiUrl) &&
      !cfg.neonAuthUrl.includes("YOUR_") &&
      !cfg.neonDataApiUrl.includes("YOUR_")
    );
  }

  function getClient() {
    if (!isConfigured()) return null;
    if (client) return client;

    // neon-js expects explicit Auth and Data API endpoints.
    // Both are public browser endpoints; no PostgreSQL password or management
    // API key is exposed here.
    client = createClient({
      auth: {
        url: cfg.neonAuthUrl
      },
      dataApi: {
        url: cfg.neonDataApiUrl
      }
    });
    return client;
  }

  function setGateState(state, message = "") {
    const gate = document.getElementById("auth-gate");
    const shell = document.querySelector(".app-layout");
    const loading = document.getElementById("app-loading");
    const setup = document.getElementById("setup-required");
    const login = document.getElementById("login-panel");
    const feedback = document.getElementById("auth-feedback");

    if (gate) gate.classList.toggle("hidden", state === "app");
    if (shell) shell.classList.toggle("app-locked", state !== "app");
    if (loading) loading.classList.toggle("hidden", state !== "loading");
    if (setup) setup.classList.toggle("hidden", state !== "setup");
    if (login) login.classList.toggle("hidden", state !== "login");
    if (feedback) {
      feedback.textContent = message;
      feedback.classList.toggle("hidden", !message);
    }
  }

  function getCallbackError() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("error");
    if (!code) return null;
    const description =
      params.get("error_description") ||
      params.get("message") ||
      code.replaceAll("_", " ");
    return new Error(`Google sign-in failed: ${description}`);
  }

  async function getCurrentUser() {
    const neon = getClient();
    if (!neon) return null;

    const callbackError = getCallbackError();
    if (callbackError) throw callbackError;

    const result = await neon.auth.getSession();
    if (result?.error) throw result.error;

    // Better Auth returns { data: { session, user } }; keep the fallback for
    // minor SDK response-shape differences between beta releases.
    const data = result?.data ?? result;
    return data?.user || data?.session?.user || null;
  }

  async function signInWithGoogle() {
    const neon = getClient();
    if (!neon) throw new Error("Neon is not configured.");

    const callbackURL = `${window.location.origin}${window.location.pathname}`;
    const result = await neon.auth.signIn.social({
      provider: "google",
      callbackURL,
      errorCallbackURL: callbackURL
    });
    if (result?.error) throw result.error;
    return result?.data || null;
  }

  async function signOut({ reload = true } = {}) {
    const neon = getClient();
    if (neon) {
      const result = await neon.auth.signOut();
      if (result?.error) throw result.error;
    }
    if (reload) window.location.reload();
  }

  async function fetchAll(table, orders = []) {
    const neon = getClient();
    if (!neon) throw new Error("Neon is not configured.");
    const rows = [];
    let from = 0;

    while (true) {
      let query = neon.from(table).select("*").range(from, from + PAGE_SIZE - 1);
      orders.forEach(({ column, ascending = true }) => {
        query = query.order(column, { ascending });
      });
      const { data, error } = await query;
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
    return rows;
  }

  async function loadAll() {
    const neon = getClient();
    if (!neon) throw new Error("Neon is not configured.");

    // Authentication alone is not enough. Only the provisioned finance owner
    // has an app_settings row and therefore passes this authorization gate.
    const settingsResult = await neon.from("app_settings").select("*").maybeSingle();
    if (settingsResult.error) throw settingsResult.error;
    if (!settingsResult.data) {
      throw new Error("This Google account is not authorized for this finance dashboard.");
    }

    const [cash, withdrawals, bni, muamalat, gopay] = await Promise.all([
      fetchAll("cash_transactions", [{ column: "tanggal" }, { column: "id" }]),
      fetchAll("atm_transactions", [{ column: "tanggal" }, { column: "id" }]),
      fetchAll("bni_transactions", [{ column: "date" }, { column: "id" }]),
      fetchAll("muamalat_transactions", [{ column: "date" }, { column: "id" }]),
      fetchAll("gopay_transactions", [{ column: "date" }, { column: "id" }])
    ]);

    return {
      cash,
      withdrawals,
      bni,
      muamalat,
      gopay,
      settings: settingsResult.data
    };
  }

  async function reconcile({ wallet, jpBank, hokurikuBank }) {
    const neon = getClient();
    if (!neon) throw new Error("Neon is not configured.");
    const { data, error } = await neon.rpc("reconcile_balance", {
      p_wallet: wallet,
      p_jp_bank: jpBank,
      p_hokuriku_bank: hokurikuBank
    });
    if (error) throw error;
    return data;
  }

  async function saveTransaction({
    id = null,
    date,
    item,
    category,
    store = "",
    flow,
    amount,
    paymentType,
    note = ""
  }) {
    const neon = getClient();
    if (!neon) throw new Error("Neon is not configured.");

    const numericAmount = Number(amount);
    if (!date) throw new Error("Transaction date is required.");
    if (!String(item || "").trim()) throw new Error("Description is required.");
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      throw new Error("Amount must be greater than zero.");
    }

    const { data, error } = await neon.rpc("save_transaction", {
      p_transaction_id: id ? Number(id) : null,
      p_date: date,
      p_item: String(item).trim(),
      p_category: String(category || "Others").trim() || "Others",
      p_store: String(store || "").trim(),
      p_flow: flow,
      p_amount: numericAmount,
      p_payment_type: paymentType,
      p_note: String(note || "").trim()
    });

    if (error) throw error;
    return data;
  }

  async function getTransactionHistory(transactionId) {
    const neon = getClient();
    if (!neon) throw new Error("Neon is not configured.");
    const id = Number(transactionId);
    if (!Number.isFinite(id)) return [];

    const { data, error } = await neon
      .from("cash_transaction_audit")
      .select("audit_id,transaction_id,action,old_row,new_row,changed_at")
      .eq("transaction_id", id)
      .order("changed_at", { ascending: false });

    if (error) throw error;
    return data || [];
  }


  function bindAuthUI() {
    const form = document.getElementById("auth-form");
    const logout = document.getElementById("logout-btn");

    if (form && !form.dataset.bound) {
      form.dataset.bound = "1";
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const button = form.querySelector("button[type='submit']");
        const old = button?.innerHTML;
        try {
          if (button) {
            button.disabled = true;
            button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Opening Google…';
          }
          setGateState("login", "Redirecting to Google for secure sign-in…");
          await signInWithGoogle();
        } catch (error) {
          setGateState("login", error.message || "Could not start Google sign-in.");
          if (button) {
            button.disabled = false;
            button.innerHTML = old;
          }
        }
      });
    }

    if (logout && !logout.dataset.bound) {
      logout.dataset.bound = "1";
      logout.addEventListener("click", () => signOut().catch(error => {
        console.error("Sign out failed:", error);
        window.location.reload();
      }));
    }
  }

  window.BudgetCloud = {
    isConfigured,
    getCurrentUser,
    loadAll,
    reconcile,
    saveTransaction,
    getTransactionHistory,
    signOut,
    bindAuthUI,
    setGateState
  };
  window.dispatchEvent(new Event("budgetcloudready"));
})();