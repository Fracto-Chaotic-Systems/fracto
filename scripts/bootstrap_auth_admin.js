const data_port = Number(process.env.FRACTO_DATA_PORT || 3002);
const MAX_INPUT_BYTES = 16 * 1024;

const read_input = async () => {
  if (process.stdin.isTTY) {
    throw new Error("Bootstrap input must be provided through protected stdin");
  }
  const chunks = [];
  let byte_length = 0;
  for await (const chunk of process.stdin) {
    byte_length += chunk.length;
    if (byte_length > MAX_INPUT_BYTES) {
      throw new Error("Bootstrap input is too large");
    }
    chunks.push(chunk);
  }
  let input;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Bootstrap input must be valid JSON");
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Bootstrap input must be a JSON object");
  }
  const confirmation = typeof input.confirmation === "string" ? input.confirmation : "";
  const provider = typeof input.provider === "string" ? input.provider.trim() : "google";
  const provider_subject = typeof input.provider_subject === "string"
    ? input.provider_subject.trim()
    : "";
  const email = typeof input.email === "string" ? input.email.trim() : "";
  const display_name = typeof input.display_name === "string"
    ? input.display_name.trim()
    : "";
  if (!confirmation || !provider || !provider_subject) {
    throw new Error("Bootstrap input requires confirmation and provider subject");
  }
  return { confirmation, provider, provider_subject, email, display_name };
};

let payload;
try {
  payload = await read_input();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

try {
  const response = await fetch(`http://127.0.0.1:${data_port}/user/bootstrap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    console.error(`Administrator bootstrap failed (${response.status})`);
    process.exitCode = 1;
  } else {
    console.log("Administrator bootstrap succeeded");
  }
} catch {
  console.error("Administrator bootstrap request failed");
  process.exitCode = 1;
}
