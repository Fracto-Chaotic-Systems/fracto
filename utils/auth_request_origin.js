/** Cookie-authenticated mutations must originate at the configured UI. */
export const trusted_mutation_origin = (req, res) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return true;
  const expected = process.env.FRACTO_UI_ORIGIN ||
    `http://localhost:${process.env.FRACTO_UI_PORT || 3006}`;
  if (req.headers.origin === expected) return true;
  res.status(403).json({ error: "Untrusted request origin" });
  return false;
};
