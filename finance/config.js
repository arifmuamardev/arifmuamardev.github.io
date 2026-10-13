/*
 * Public browser configuration for Neon.
 * These are public HTTPS service endpoints, NOT PostgreSQL connection strings.
 * NEVER put DATABASE_URL, Neon API keys, role passwords, or other secrets here.
 */
window.BUDGET_CLOUD_CONFIG = Object.freeze({
  appName: "Personal Finance",
  neonAuthUrl: "https://ep-wandering-tooth-b5e616na.neonauth.c-7.us-east-2.aws.neon.tech/finance/auth",
  neonDataApiUrl: "https://ep-wandering-tooth-b5e616na.apirest.c-7.us-east-2.aws.neon.tech/finance/rest/v1",
  exchangeRateFallback: 109.6,
  supportEmail: ""
});