-- Complete baseline tables absent from some legacy installations.
-- Create empty lore tables; content is supplied through normal data workflows.
CREATE TABLE IF NOT EXISTS `lore_category` (
  `id` int NOT NULL,
  `category_name` varchar(255) NOT NULL,
  `description` varchar(255) NOT NULL,
  `plural_name` varchar(255) NOT NULL,
  `key_prefix` varchar(45) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `lore_content` (
  `id` int NOT NULL AUTO_INCREMENT,
  `title` varchar(255) NOT NULL,
  `category` int NOT NULL,
  `content_data` json NOT NULL,
  `content_meta` json DEFAULT NULL,
  `key` varchar(45) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Match the shared video baseline without changing the column's values/type.
ALTER TABLE `videos`
  MODIFY COLUMN `archived` tinyint(1) NOT NULL DEFAULT '0'
  AFTER `script_version`;
