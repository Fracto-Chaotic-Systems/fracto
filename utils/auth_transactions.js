import crypto from "node:crypto";

import { append_set_cookie, get_cookie } from "./auth_sessions.js";

export const AUTH_TRANSACTION_COOKIE_NAME =
  process.env.FRACTO_OIDC_TRANSACTION_COOKIE || "fracto_oidc_transaction";
export const AUTH_TRANSACTION_TTL_MS = Number(
  process.env.FRACTO_OIDC_TRANSACTION_TTL_MS || 10 * 60 * 1000,
);

if (!Number.isFinite(AUTH_TRANSACTION_TTL_MS) || AUTH_TRANSACTION_TTL_MS <= 0) {
  throw new Error("FRACTO_OIDC_TRANSACTION_TTL_MS must be a positive number");
}

const transactions = new Map();
const MAX_TRANSACTIONS = 1000;

const secure_cookies = () =>
  process.env.FRACTO_AUTH_SECURE_COOKIES === "true" ||
  process.env.NODE_ENV === "production";

const cookie_attributes = (max_age) =>
  [
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(max_age / 1000))}`,
    secure_cookies() ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");

const remove_expired_transactions = () => {
  const now = Date.now();
  for (const [state, transaction] of transactions.entries()) {
    if (transaction.expires_at <= now) transactions.delete(state);
  }
};

/** Store the one-time values needed to complete one provider redirect. */
export const create_auth_transaction = ({
  state,
  nonce,
  code_verifier,
  return_to = "/",
}) => {
  remove_expired_transactions();
  while (transactions.size >= MAX_TRANSACTIONS) {
    transactions.delete(transactions.keys().next().value);
  }
  const now = Date.now();
  const transaction = {
    state: state || crypto.randomBytes(32).toString("base64url"),
    nonce,
    code_verifier,
    return_to,
    created_at: now,
    expires_at: now + AUTH_TRANSACTION_TTL_MS,
  };
  transactions.set(transaction.state, transaction);
  return transaction;
};

/** Consume a transaction exactly once after validating its state. */
export const consume_auth_transaction = (state) => {
  remove_expired_transactions();
  if (!state) return null;
  const transaction = transactions.get(state) || null;
  transactions.delete(state);
  return transaction;
};

/** Read a still-valid transaction without consuming it for token exchange. */
export const get_auth_transaction = (state) => {
  remove_expired_transactions();
  if (!state) return null;
  return transactions.get(state) || null;
};

/** Read the browser's OIDC transaction cookie. */
export const get_auth_transaction_cookie = (request) =>
  get_cookie(request, AUTH_TRANSACTION_COOKIE_NAME);

/** Bind the browser to the server-side OIDC transaction. */
export const set_auth_transaction_cookie = (response, state) => {
  append_set_cookie(
    response,
    `${AUTH_TRANSACTION_COOKIE_NAME}=${encodeURIComponent(state)}; ${cookie_attributes(AUTH_TRANSACTION_TTL_MS)}`,
  );
};

/** Remove the one-time transaction cookie after callback processing. */
export const clear_auth_transaction_cookie = (response) => {
  append_set_cookie(
    response,
    `${AUTH_TRANSACTION_COOKIE_NAME}=; ${cookie_attributes(0)}`,
  );
};
