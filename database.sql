ALTER TABLE `jobs` ADD COLUMN IF NOT EXISTS `description` TEXT NULL DEFAULT NULL;
ALTER TABLE `jobs` ADD COLUMN IF NOT EXISTS `applications_open` TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE `jobs` ADD COLUMN IF NOT EXISTS `application_text` TEXT NULL DEFAULT NULL;

CREATE TABLE IF NOT EXISTS `job_applications` (
    `id`             INT NOT NULL AUTO_INCREMENT,
    `job_name`       VARCHAR(50)  NOT NULL,
    `identifier`     VARCHAR(60)  NOT NULL,
    `applicant_name` VARCHAR(100) NOT NULL,
    `subject`        VARCHAR(150) NOT NULL,
    `body`           TEXT         NOT NULL,
    `greeting`       VARCHAR(150) NOT NULL,
    `status`         VARCHAR(20)  NOT NULL DEFAULT 'open',
    `created_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_job_name` (`job_name`),
    KEY `idx_identifier` (`identifier`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `job_application_messages` (
    `id`             INT NOT NULL AUTO_INCREMENT,
    `application_id` INT NOT NULL,
    `sender`         VARCHAR(20)  NOT NULL,
    `sender_name`    VARCHAR(100) NOT NULL,
    `message`        TEXT         NOT NULL,
    `created_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_application_id` (`application_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;