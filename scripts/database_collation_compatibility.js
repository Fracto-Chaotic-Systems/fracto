export const normalize_backup_collations = (sql, supported_collations) => {
   const mysql_8_collation = 'utf8mb4_0900_ai_ci'
   if (!sql.includes(mysql_8_collation) || supported_collations.has(mysql_8_collation)) {
      return sql
   }

   const mariadb_compatible_collation = 'utf8mb4_unicode_520_ci'
   if (!supported_collations.has(mariadb_compatible_collation)) {
      throw new Error(
         `Database does not support ${mysql_8_collation} or ${mariadb_compatible_collation}`,
      )
   }
   return sql.replaceAll(mysql_8_collation, mariadb_compatible_collation)
}
