import { migration_checksums } from '../utils/migration_checksums.js'

export const migration_checksum_matches = (bytes, recorded) =>
   migration_checksums(bytes).accepted.has(recorded)
