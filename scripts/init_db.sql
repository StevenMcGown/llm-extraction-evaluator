-- Database initialization script for llm-extraction-evaluator
-- Creates the necessary tables for the application

-- Create database if it doesn't exist
CREATE DATABASE IF NOT EXISTS `llm-extraction-evaluator-ground-truth-test-mysql`;
USE `llm-extraction-evaluator-ground-truth-test-mysql`;

-- Files table - stores uploaded file metadata
CREATE TABLE IF NOT EXISTS `files` (
    `file_id` VARCHAR(36) PRIMARY KEY,
    `file_hash` VARCHAR(64) NOT NULL UNIQUE,
    `original_name` VARCHAR(255) NOT NULL,
    `s3_key` VARCHAR(500) NOT NULL,
    `uploaded_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX `idx_file_hash` (`file_hash`),
    INDEX `idx_uploaded_at` (`uploaded_at`)
);

-- Ground truths table - stores ground truth data for evaluation
CREATE TABLE IF NOT EXISTS `ground_truths` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `file_id` VARCHAR(36) NOT NULL,
    `ground_truth_data` JSON,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (`file_id`) REFERENCES `files`(`file_id`) ON DELETE CASCADE,
    INDEX `idx_file_id` (`file_id`)
);

-- Extraction runs table - stores extraction results for comparison
CREATE TABLE IF NOT EXISTS `extraction_runs` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `file_id` VARCHAR(36) NOT NULL,
    `extraction_data` JSON,
    `model_name` VARCHAR(100),
    `run_timestamp` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `execution_time_ms` INT,
    FOREIGN KEY (`file_id`) REFERENCES `files`(`file_id`) ON DELETE CASCADE,
    INDEX `idx_file_id` (`file_id`),
    INDEX `idx_model_name` (`model_name`),
    INDEX `idx_run_timestamp` (`run_timestamp`)
);

-- Test table for basic functionality
CREATE TABLE IF NOT EXISTS `test_table` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `ts` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Display the created tables
SHOW TABLES; 