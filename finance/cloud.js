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
      cfg.neonDatabaseUrl &&
      /^https:\/\//i.test(cfg.neonDatabaseUrl) &&
      !cfg.neonDatabaseUrl.includes("YOUR_")
    );
  }

  function getClient() {
    if (!isConfigured()) return null;
    if (client) return client;
    // The single public database URL lets neon-js derive both the branch-scoped
    // Managed Better Auth endpoint and Data API endpoint. No database password
    // or Neon management API key is shipped to the browser.
    client = createClient(cfg.neonDatabaseUrl);
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

  async function getCurrentUser() {
    const neon = getClient();
    if (!neon) return null;
    const result = await neon.auth.getSession();
    if (result?.error) throw result.error;
    return result?.data?.user || null;
  }

  async function signInWithGoogle() {
    const neon = getClient();
    if (!neon) throw new Error("Neon is not configured.");
    const callbackURL = window.location.origin + window.location.pathname;
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

    // Authorization gate: authentication alone is not enough. Only a user that
    // has been explicitly provisioned in app_settings may open this dashboard.
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
    signOut,
    bindAuthUI,
    setGateState
  };
  window.dispatchEvent(new Event("budgetcloudready"));
})();