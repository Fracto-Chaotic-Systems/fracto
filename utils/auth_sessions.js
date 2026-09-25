import crypto from "node:crypto";

export const AUTH_COOKIE_NAME =
  process.env.FRACTO_AUTH_COOKIE_NAME || "fracto_session";
export const SESSION_TTL_MS = Number(
  process.env.FRACTO_SESSION_TTL_MS || 8 * 60 * 60 * 1000,
);

if (!Number.isFinite(SESSION_TTL_MS) || SESSION_TTL_MS <= 0) {
  throw new Error("FRACTO_SESSION_TTL_MS must be a positive number");
}

const sessions = new Map();
const MAX_SESSIONS = Number(process.env.FRACTO_MAX_SESSIONS || 10000);

if (!Number.isFinite(MAX_SESSIONS) || MAX_SESSIONS <= 0) {
  throw new Error("FRACTO_MAX_SESSIONS must be a positive number");
}

const remove_expired_sessions = () => {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (session.expires_at <= now) {
      sessions.delete(token);
    }
  }
};

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

/** Create an opaque server-side session for a validated user identity. */
export const create_session = (user) => {
  remove_expired_sessions();
  while (sessions.size >= MAX_SESSIONS) {
    sessions.delete(sessions.keys().next().value);
  }
  const token = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  sessions.set(token, {
    user: { ...user },
    created_at: now,
    expires_at: now + SESSION_TTL_MS,
  });
  return { token, expires_at: now + SESSION_TTL_MS };
};

/** Return a non-expired session and remove expired entries. */
export const get_session = (token) => {
  remove_expired_sessions();
  if (!token) {
    return null;
  }
  const session = sessions.get(token);
  if (!session || session.expires_at <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session;
};

/** Extend a valid session using the configured sliding lifetime. */
export const renew_session = (token) => {
  const session = get_session(token);
  if (!session) {
    return null;
  }
  session.expires_at = Date.now() + SESSION_TTL_MS;
  return session;
};

/** Invalidate a session token. */
export const destroy_session = (token) => {
  if (token) {
    sessions.delete(token);
  }
};

/** Read one cookie value from a request cookie header. */
export const get_cookie = (request, name) => {
  const header = request.headers.cookie || "";
  const match = header
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${name}=`));
  if (!match) return null;
  try {
    return decodeURIComponent(match.slice(name.length + 1));
  } catch {
    return null;
  }
};

/** Attach the opaque session cookie to a response. */
export const set_session_cookie = (response, token, max_age = SESSION_TTL_MS) => {
  response.setHeader(
    "Set-Cookie",
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}; ${cookie_attributes(max_age)}`,
  );
};

/** Clear the browser session cookie. */
export const clear_session_cookie = (response) => {
  response.setHeader(
    "Set-Cookie",
    `${AUTH_COOKIE_NAME}=; ${cookie_attributes(0)}`,
  );
};

/** Return a session-safe user representation without credentials. */
export const public_user = (user) => ({
  id: user?.id ?? null,
  provider: user?.provider ?? null,
  provider_subject: user?.provider_subject ?? null,
  email: user?.email ?? null,
  display_name: user?.display_name ?? null,
  role: user?.role ?? null,
});
