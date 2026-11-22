import http from "node:http";
import https from "node:https";

/** Bounded streaming transport; endpoint ownership and authorization stay with callers. */
export function create_http_proxy({
  origin,
  prefix = "",
  timeout_ms = 180000,
  error = "service_unavailable",
  forward_headers = [],
  request_headers = () => ({}),
}) {
  return (req, res) => {
    const target = new URL(typeof origin === "function" ? origin() : origin);
    const headers = {};
    for (const key of [
      "content-type",
      "content-length",
      "cookie",
      "origin",
      "range",
      "if-none-match",
      "if-modified-since",
      "if-range",
      ...forward_headers,
    ])
      if (req.headers[key]) headers[key] = req.headers[key];
    Object.assign(headers, request_headers(req));
    const upstream = (target.protocol === "https:" ? https : http).request(
      {
        hostname: target.hostname,
        port: target.port,
        method: req.method,
        path: prefix + (req.url === "/" ? "" : req.url),
        headers,
      },
      (response) => {
        res.writeHead(response.statusCode, response.headers);
        response.pipe(res);
        response.on("error", () => res.destroy());
      },
    );
    upstream.setTimeout(timeout_ms, () => upstream.destroy());
    upstream.on("error", () => {
      if (res.headersSent) return res.destroy();
      res.writeHead(503, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify({ error }));
    });
    req.on("aborted", () => upstream.destroy());
    res.on("close", () => {
      if (!res.writableEnded) upstream.destroy();
    });
    req.pipe(upstream);
  };
}
