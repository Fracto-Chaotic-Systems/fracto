import { create_orbital_database_pool } from "../servers/fracto-data-server/handlers/orbital_data_database.js";
import { OrbitalDataStore } from "../servers/fracto-data-server/handlers/orbital_data_store.js";
import { OrbitalFamilyInvestigationStore } from "../servers/fracto-data-server/handlers/orbital_family_investigations.js";
import { OrbitalDiscoveryJobs } from "../servers/fracto-data-server/handlers/orbital_data_jobs.js";
import { WorkerTaskPool } from "../servers/fracto-data-server/handlers/worker_task_pool.js";

// Executed only by the disposable-schema integration test. The parent kills this
// process after the ledger commits but before publication/checkpoint advances.
if (
  !process.send ||
  !/^fracto_(?:catalog|compact)_job_test_[a-f0-9]{32}$/.test(
    process.env.FRACTO_CATALOG_CRASH_SCHEMA || "",
  )
)
  throw Error("Disposable catalog crash fixture requires its parent test");
const database = await create_orbital_database_pool(
  process.env.FRACTO_CATALOG_CRASH_SCHEMA,
);
const store = new OrbitalDataStore({ open: () => database.getConnection() });
const family_store = new OrbitalFamilyInvestigationStore({ database: store });
const complete = family_store.complete.bind(family_store);
family_store.complete = async (...args) => {
  await complete(...args);
  process.send({ event: "ledger_committed", family_key: args[0].family.key });
  await new Promise(() => {});
};
const pool = new WorkerTaskPool({ size: 1 });
const jobs = new OrbitalDiscoveryJobs({ store, family_store, pool });
await jobs.resume(process.env.FRACTO_CATALOG_CRASH_RUN);
