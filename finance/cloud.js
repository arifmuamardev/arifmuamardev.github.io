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
    const error = new Error(`Google sign-in failed: ${description}`);
    error.code = code;
    return error;
  }

  function getResetToken() {
    return new URLSearchParams(window.location.search).get("token");
  }

  function clearAuthQuery() {
    const url = new URL(window.location.href);
    ["error", "error_description", "message", "token", "auth"].forEach(key => {
      url.searchParams.delete(key);
    });
    const query = url.searchParams.toString();
    const clean = `${url.pathname}${query ? `?${query}` : ""}${url.hash}`;
    window.history.replaceState(null, "", clean);
  }

  function setRecoveryUI({ open = false, canLink = false, reset = false } = {}) {
    const panel = document.getElementById("auth-recovery-panel");
    const linkButton = document.getElementById("auth-link-google");
    const resetForm = document.getElementById("auth-reset-form");
    if (panel) panel.open = Boolean(open);
    if (linkButton) linkButton.classList.toggle("hidden", !canLink);
    if (resetForm) resetForm.classList.toggle("hidden", !reset);
  }

  async function getCurrentUser() {
    const neon = getClient();
    if (!neon) return null;

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

  async function signInWithEmail({ email, password }) {
    const neon = getClient();
    if (!neon) throw new Error("Neon is not configured.");
    if (!neon.auth?.signIn?.email) throw new Error("Email sign-in is unavailable in this Auth client.");

    const result = await neon.auth.signIn.email({
      email: String(email || "").trim(),
      password: String(password || ""),
      rememberMe: true
    });
    if (result?.error) throw result.error;
    return result?.data || null;
  }

  async function requestPasswordReset(email) {
    const neon = getClient();
    if (!neon) throw new Error("Neon is not configured.");
    if (typeof neon.auth?.requestPasswordReset !== "function") {
      throw new Error("Password recovery is unavailable in this Auth client.");
    }

    const redirectTo = `${window.location.origin}${window.location.pathname}?auth=reset`;
    const result = await neon.auth.requestPasswordReset({
      email: String(email || "").trim(),
      redirectTo
    });
    if (result?.error) throw result.error;
    return result?.data || null;
  }

  async function resetPassword({ token, newPassword }) {
    const neon = getClient();
    if (!neon) throw new Error("Neon is not configured.");
    if (typeof neon.auth?.resetPassword !== "function") {
      throw new Error("Password reset is unavailable in this Auth client.");
    }

    const result = await neon.auth.resetPassword({
      newPassword: String(newPassword || ""),
      token: String(token || "")
    });
    if (result?.error) throw result.error;
    return result?.data || null;
  }

  async function linkGoogle() {
    const neon = getClient();
    if (!neon) throw new Error("Neon is not configured.");
    if (typeof neon.auth?.linkSocial !== "function") {
      throw new Error("Google account linking is unavailable in this Auth client.");
    }

    const callbackURL = `${window.location.origin}${window.location.pathname}?auth=linked`;
    const errorCallbackURL = `${window.location.origin}${window.location.pathname}?auth=link-error`;
    const result = await neon.auth.linkSocial({
      provider: "google",
      callbackURL,
      errorCallbackURL
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

    const [cash, withdrawals, bni, muamalat, gopay, budgets] = await Promise.all([
      fetchAll("cash_transactions", [{ column: "tanggal" }, { column: "id" }]),
      fetchAll("atm_transactions", [{ column: "tanggal" }, { column: "id" }]),
      fetchAll("bni_transactions", [{ column: "date" }, { column: "id" }]),
      fetchAll("muamalat_transactions", [{ column: "date" }, { column: "id" }]),
      fetchAll("gopay_transactions", [{ column: "date" }, { column: "id" }]),
      fetchAll("monthly_budgets", [{ column: "month_start" }, { column: "category" }])
    ]);

    // Private, owner-scoped card evidence. Failure must be visible in review UI,
    // but must never block sign-in or hide existing financial records.
    let cardEvidence = [];
    let cardEvidenceError = false;
    try {
      cardEvidence = await fetchAll("cc_ku_evidence", [
        { column: "reference_date" }, { column: "evidence_key" }
      ]);
    } catch (error) {
      console.error("Unable to load VISA evidence:", error);
      cardEvidenceError = true;
    }

    // Private screenshot evidence. A failure must not affect sign-in or
    // other dashboard views. This table is read-only for authenticated users.
    let tokopediaEvidence = [];
    let tokopediaEvidenceError = false;
    try {
      tokopediaEvidence = await fetchAll("tokopedia_card_evidence", [
        { column: "captured_on" }, { column: "evidence_key" }
      ]);
    } catch (error) {
      console.error("Unable to load Tokopedia Card evidence:", error);
      tokopediaEvidenceError = true;
    }

    return {
      cash,
      withdrawals,
      bni,
      muamalat,
      gopay,
      budgets,
      cardEvidence,
      cardEvidenceError,
      tokopediaEvidence,
      tokopediaEvidenceError,
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

  async function saveMonthlyBudget({ month, category, amount }) {
    const neon = getClient();
    if (!neon) throw new Error("Neon is not configured.");
    const numericAmount = Number(amount);
    if (!month) throw new Error("Budget month is required.");
    if (!String(category || "").trim()) throw new Error("Budget category is required.");
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      throw new Error("Budget amount must be greater than zero.");
    }

    const monthDate = /^\d{4}-\d{2}$/.test(month) ? `${month}-01` : month;
    const { data, error } = await neon.rpc("save_monthly_budget", {
      p_month: monthDate,
      p_category: String(category).trim(),
      p_amount: numericAmount
    });
    if (error) throw error;
    return data;
  }

  async function removeMonthlyBudget(id) {
    const neon = getClient();
    if (!neon) throw new Error("Neon is not configured.");
    const budgetId = Number(id);
    if (!Number.isFinite(budgetId)) throw new Error("Budget target is invalid.");
    const { data, error } = await neon.rpc("remove_monthly_budget", {
      p_budget_id: budgetId
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


  async function getAuditCount() {
    const neon = getClient();
    if (!neon) throw new Error("Neon is not configured.");
    const { count, error } = await neon
      .from("cash_transaction_audit")
      .select("audit_id", { count: "exact", head: true });
    if (error) throw error;
    return Number(count) || 0;
  }

  async function getAllAuditHistory() {
    return fetchAll("cash_transaction_audit", [
      { column: "changed_at" },
      { column: "audit_id" }
    ]);
  }


  function bindAuthUI() {
    const form = document.getElementById("auth-form");
    const recoveryForm = document.getElementById("auth-recovery-form");
    const resetRequest = document.getElementById("auth-reset-request");
    const resetForm = document.getElementById("auth-reset-form");
    const linkButton = document.getElementById("auth-link-google");
    const logout = document.getElementById("logout-btn");

    const resetToken = getResetToken();
    if (resetToken) setRecoveryUI({ open: true, reset: true });

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

    if (recoveryForm && !recoveryForm.dataset.bound) {
      recoveryForm.dataset.bound = "1";
      recoveryForm.addEventListener("submit", async event => {
        event.preventDefault();
        const email = document.getElementById("auth-recovery-email")?.value?.trim();
        const password = document.getElementById("auth-recovery-password")?.value || "";
        const button = recoveryForm.querySelector("button[type='submit']");
        const old = button?.innerHTML;

        try {
          if (!email || !password) throw new Error("Enter your email and password.");
          if (button) {
            button.disabled = true;
            button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Verifying…';
          }
          setGateState("login", "Verifying the existing account…");
          await signInWithEmail({ email, password });
          const user = await getCurrentUser();
          if (!user) throw new Error("Credential sign-in did not create a session.");

          setRecoveryUI({ open: true, canLink: true });
          setGateState("login", "Existing account verified. Redirecting to Google to link it permanently…");
          await linkGoogle();
        } catch (error) {
          setGateState("login", error.message || "Account recovery sign-in failed.");
          setRecoveryUI({ open: true });
          if (button) {
            button.disabled = false;
            button.innerHTML = old;
          }
        }
      });
    }

    if (resetRequest && !resetRequest.dataset.bound) {
      resetRequest.dataset.bound = "1";
      resetRequest.addEventListener("click", async () => {
        const email = document.getElementById("auth-recovery-email")?.value?.trim();
        const old = resetRequest.innerHTML;
        try {
          if (!email) throw new Error("Enter your email first.");
          resetRequest.disabled = true;
          resetRequest.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending…';
          await requestPasswordReset(email);
          setGateState("login", "If the account exists, a password reset email has been sent. Open that email and return here through its secure link.");
          setRecoveryUI({ open: true });
        } catch (error) {
          setGateState("login", error.message || "Password reset could not be started.");
          setRecoveryUI({ open: true });
        } finally {
          resetRequest.disabled = false;
          resetRequest.innerHTML = old;
        }
      });
    }

    if (resetForm && !resetForm.dataset.bound) {
      resetForm.dataset.bound = "1";
      resetForm.addEventListener("submit", async event => {
        event.preventDefault();
        const token = getResetToken();
        const password = document.getElementById("auth-new-password")?.value || "";
        const confirm = document.getElementById("auth-confirm-password")?.value || "";
        const button = resetForm.querySelector("button[type='submit']");
        const old = button?.innerHTML;

        try {
          if (!token) throw new Error("The password reset token is missing.");
          if (password.length < 8) throw new Error("Use a password with at least 8 characters.");
          if (password !== confirm) throw new Error("The two passwords do not match.");
          if (button) {
            button.disabled = true;
            button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Setting password…';
          }
          await resetPassword({ token, newPassword: password });
          clearAuthQuery();
          resetForm.reset();
          setRecoveryUI({ open: true, reset: false });
          setGateState("login", "Password set. Sign in below once to verify the existing account and link Google.");
        } catch (error) {
          setGateState("login", error.message || "Password reset failed.");
          setRecoveryUI({ open: true, reset: true });
        } finally {
          if (button) {
            button.disabled = false;
            button.innerHTML = old;
          }
        }
      });
    }

    if (linkButton && !linkButton.dataset.bound) {
      linkButton.dataset.bound = "1";
      linkButton.addEventListener("click", async () => {
        const old = linkButton.innerHTML;
        try {
          linkButton.disabled = true;
          linkButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Opening Google…';
          await linkGoogle();
        } catch (error) {
          setGateState("login", error.message || "Google linking could not be started.");
          setRecoveryUI({ open: true, canLink: true });
          linkButton.disabled = false;
          linkButton.innerHTML = old;
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
    getCallbackError,
    getResetToken,
    clearAuthQuery,
    setRecoveryUI,
    getCurrentUser,
    loadAll,
    reconcile,
    saveTransaction,
    saveMonthlyBudget,
    removeMonthlyBudget,
    getTransactionHistory,
    getAuditCount,
    getAllAuditHistory,
    signInWithEmail,
    requestPasswordReset,
    resetPassword,
    linkGoogle,
    signOut,
    bindAuthUI,
    setGateState
  };
  window.dispatchEvent(new Event("budgetcloudready"));
})();