import crypto from 'node:crypto'

// Applied SQL remains immutable; only Windows/Unix newline representations vary.
export const migration_checksum_matches = (bytes, recorded) => {
   const hash = value => crypto.createHash('sha256').update(value).digest('hex')
   if (hash(bytes) === recorded) return true
   const lf = bytes.toString('utf8').replace(/\r\n/g, '\n')
   return hash(Buffer.from(lf)) === recorded ||
      hash(Buffer.from(lf.replace(/\n/g, '\r\n'))) === recorded
}
