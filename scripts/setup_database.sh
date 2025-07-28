#!/bin/bash

# Database setup script for llm-extraction-evaluator
# This script sets up environment variables and initializes the database

set -e  # Exit on any error

echo "Setting up database for llm-extraction-evaluator..."

# Set environment variables for database connection
export DB_HOST=127.0.0.1
export DB_PORT=3306
export DB_USER=llm-extraction-evaluator_user
export DB_PASSWORD=llm-extraction-evaluator_secure_password123
export DB_NAME=llm-extraction-evaluator-ground-truth-test-mysql

echo "Environment variables set:"
echo "DB_HOST: $DB_HOST"
echo "DB_PORT: $DB_PORT"
echo "DB_USER: $DB_USER"
echo "DB_NAME: $DB_NAME"

# Check if MySQL container is running
if ! docker ps | grep -q "llm-extraction-evaluator-mysql"; then
    echo "Error: No MySQL container named 'llm-extraction-evaluator-mysql' is running."
    echo "Please start a MySQL container first."
    exit 1
fi

echo "Initializing database schema..."

# Execute the SQL initialization script
docker exec -i llm-extraction-evaluator-mysql mysql -uroot -p$DB_PASSWORD << 'EOF'
-- Create user if it doesn't exist
CREATE USER IF NOT EXISTS 'llm-extraction-evaluator_user'@'%' IDENTIFIED BY 'llm-extraction-evaluator_secure_password123';
GRANT ALL PRIVILEGES ON *.* TO 'llm-extraction-evaluator_user'@'%';
FLUSH PRIVILEGES;

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
EOF

echo "Database initialization completed successfully!"
echo ""
echo "To use these environment variables in your application, run:"
echo "export DB_HOST=127.0.0.1"
echo "export DB_PORT=3306"
echo "export DB_USER=llm-extraction-evaluator_user"
echo "export DB_PASSWORD=llm-extraction-evaluator_secure_password123"
echo "export DB_NAME=llm-extraction-evaluator-ground-truth-test-mysql"
echo ""
echo "Or create a .env file in your backend directory with these values." 