import path from "node:path";

// Keep this entry point dependency-free so a stale host installation explains
// how to recover before the migration module loads SDK/database dependencies.
export async function run_migrations(load = (specifier) => import(specifier)) {
  try {
    await load("@fracto/sdk/utils/MigrationChecksums.js");
  } catch (error) {
    console.error(
      `Database migration dependencies are unavailable: ${error.message}`,
    );
    console.error(
      "Updating Git repositories does not install npm dependencies. From the root checkout, run npm ci, then retry npm run db:migrate. " +
        "For a Docker installation, use docker compose run --build --rm database-init instead; host npm dependencies are not installed by cold_boot.",
    );
    return 1;
  }
  await load("./initialize_database.js");
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  try {
    process.exitCode = await run_migrations();
  } catch (error) {
    console.error(`Database migration failed: ${error.message}`);
    process.exitCode = 1;
  }
}
