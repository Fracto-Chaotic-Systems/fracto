import { create_environment_asset_database } from "../utils/environment_asset_database.js";
import { create_environment_catalog } from "../utils/environment_catalog.js";

const registry = create_environment_asset_database();
try {
  const { assets } = await create_environment_catalog({ registry }).list();
  console.log(
    `Registered ${assets.length} environment assets in the database.`,
  );
} finally {
  await registry.close();
}
