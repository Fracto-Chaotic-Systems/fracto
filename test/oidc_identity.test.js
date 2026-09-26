import test from "node:test";
import assert from "node:assert/strict";

import { normalize_oidc_identity } from "../utils/oidc_identity.js";

const valid_claims = () => ({
  iss: "https://accounts.google.com",
  aud: "client-id",
  sub: "google-subject",
  exp: Math.floor(Date.now() / 1000) + 300,
  iat: Math.floor(Date.now() / 1000),
  nonce: "nonce-value",
  email: "user@example.com",
  email_verified: true,
  name: "Example User",
});

test("normalizes a valid OIDC identity", () => {
  assert.deepEqual(
    normalize_oidc_identity({
      claims: valid_claims(),
      issuer: "https://accounts.google.com/",
      client_id: "client-id",
      expected_nonce: "nonce-value",
    }),
    {
      provider: "google",
      provider_subject: "google-subject",
      email: "user@example.com",
      email_verified: true,
      display_name: "Example User",
    },
  );
});

test("rejects an ID token for a different audience", () => {
  assert.throws(
    () =>
      normalize_oidc_identity({
        claims: { ...valid_claims(), aud: "other-client" },
        issuer: "https://accounts.google.com",
        client_id: "client-id",
        expected_nonce: "nonce-value",
      }),
    /audience is invalid/,
  );
});

test("rejects an expired ID token", () => {
  assert.throws(
    () =>
      normalize_oidc_identity({
        claims: { ...valid_claims(), exp: Math.floor(Date.now() / 1000) - 120 },
        issuer: "https://accounts.google.com",
        client_id: "client-id",
        expected_nonce: "nonce-value",
      }),
    /expired/,
  );
});
