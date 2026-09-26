const data_port = Number(process.env.FRACTO_DATA_PORT || 3002);
const confirmation = process.env.FRACTO_BOOTSTRAP_ADMIN_CONFIRM;
const provider = process.env.FRACTO_BOOTSTRAP_ADMIN_PROVIDER || "google";
const provider_subject = process.env.FRACTO_BOOTSTRAP_ADMIN_SUBJECT;
const email = process.env.FRACTO_BOOTSTRAP_ADMIN_EMAIL || "";
const display_name = process.env.FRACTO_BOOTSTRAP_ADMIN_NAME || "";

if (!confirmation || !provider_subject) {
  console.error(
    "Set FRACTO_BOOTSTRAP_ADMIN_CONFIRM and FRACTO_BOOTSTRAP_ADMIN_SUBJECT before running this command.",
  );
  process.exit(1);
}

const response = await fetch(`http://127.0.0.1:${data_port}/user/bootstrap`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    confirmation,
    provider,
    provider_subject,
    email,
    display_name,
  }),
});
const body = await response.json().catch(() => ({}));
if (!response.ok) {
  console.error(body.error || `Administrator bootstrap failed (${response.status})`);
  process.exit(1);
}
console.log(`Administrator enabled: ${body.user?.email || body.user?.provider_subject}`);
