import { migration_checksums } from "@fracto/sdk/utils/MigrationChecksums.js"

export const migration_checksum_matches = (bytes, recorded) =>
   migration_checksums(bytes).accepted.has(recorded)
