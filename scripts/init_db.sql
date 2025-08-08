-- Database initialization script for llm-extraction-evaluator
-- Creates the necessary tables for the application

-- Create database if it doesn't exist
CREATE DATABASE IF NOT EXISTS `llm-extraction-evaluator-ground-truth-test-mysql`;
USE `llm-extraction-evaluator-ground-truth-test-mysql`;

-- Evaluation metrics table - stores evaluation results for dashboard graphs
CREATE TABLE IF NOT EXISTS `evaluation_metrics` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `file_id` VARCHAR(36) NOT NULL,
    -- `model_name` VARCHAR(100) NOT NULL,
    `evaluation_timestamp` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Overall metrics
    `overall_precision` DECIMAL(5,4),
    `overall_recall` DECIMAL(5,4),
    `overall_f1_score` DECIMAL(5,4),
    `overall_accuracy` DECIMAL(5,4),
    `overall_tp` INT,
    `overall_tn` INT,
    `overall_fp` INT,
    `overall_fn` INT,
    
    -- Additional metadata
    `ground_truth_file_id` VARCHAR(500),
    `extraction_run_id` INT,
    `evaluation_config` JSON,
    
    INDEX `idx_file_id` (`file_id`),
    INDEX `idx_evaluation_timestamp` (`evaluation_timestamp`),
    INDEX `idx_ground_truth_file_id` (`ground_truth_file_id`)
);

-- Field performance table - stores individual field metrics for analytics
CREATE TABLE IF NOT EXISTS `field_performance` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `evaluation_id` INT NOT NULL,
    `field_name` VARCHAR(500) NOT NULL,
    `field_path` VARCHAR(1000) NOT NULL,
    `tp` INT DEFAULT 0,
    `tn` INT DEFAULT 0,
    `fp` INT DEFAULT 0,
    `fn` INT DEFAULT 0,
    `precision` DECIMAL(5,4),
    `recall` DECIMAL(5,4),
    `f1_score` DECIMAL(5,4),
    `accuracy` DECIMAL(5,4),
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (`evaluation_id`) REFERENCES `evaluation_metrics`(`id`) ON DELETE CASCADE,
    INDEX `idx_evaluation_id` (`evaluation_id`),
    INDEX `idx_field_name` (`field_name`),
    INDEX `idx_field_path` (`field_path`),
    INDEX `idx_created_at` (`created_at`)
);

-- Display the created tables
SHOW TABLES; 