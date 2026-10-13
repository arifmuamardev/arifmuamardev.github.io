/*
 * Public browser configuration for Neon.
 * This is a public HTTPS database endpoint, NOT a PostgreSQL connection string.
 * NEVER put DATABASE_URL, Neon API keys, role passwords, or other secrets here.
 */
window.BUDGET_CLOUD_CONFIG = Object.freeze({
  appName: "Personal Finance",
  neonDatabaseUrl: "https://ep-wandering-tooth-b5e616na.c-7.us-east-2.aws.neon.tech/finance",
  exchangeRateFallback: 109.6,
  supportEmail: ""
});