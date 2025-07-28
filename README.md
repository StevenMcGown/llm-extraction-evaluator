# LLM Extraction Evaluator

A tool for evaluating LLM extraction performance with ground truth data comparison.

## Database Setup

This application uses MySQL for storing file metadata, ground truth data, and extraction results.

### Quick Setup

1. **Create MySQL Container with Persistent Storage**
   ```bash
   # Create a Docker volume for data persistence
   docker volume create llm-extraction-evaluator-mysql-data
   
   # Run MySQL container
   docker run -d --name llm-extraction-evaluator-mysql \
     -e MYSQL_ROOT_PASSWORD=llm-extraction-evaluator_secure_password123 \
     -e MYSQL_USER=llm-extraction-evaluator_user \
     -e MYSQL_PASSWORD=llm-extraction-evaluator_secure_password123 \
     -e MYSQL_DATABASE=llm-extraction-evaluator-ground-truth-test-mysql \
     -p 3306:3306 \
     -v llm-extraction-evaluator-mysql-data:/var/lib/mysql \
     mysql:8.0
   ```

2. **Initialize Database Tables**
   
   Create `scripts/init_db.sql` with the following content:
   ```sql
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
   ```

3. **Execute the initialization script**
   ```bash
   docker exec -i llm-extraction-evaluator-mysql mysql -uroot -pllm-extraction-evaluator_secure_password123 < scripts/init_db.sql
   ```

4. **Set Environment Variables**
   ```bash
   export DB_HOST=127.0.0.1
   export DB_PORT=3306
   export DB_USER=llm-extraction-evaluator_user
   export DB_PASSWORD=llm-extraction-evaluator_secure_password123
   export DB_NAME=llm-extraction-evaluator-ground-truth-test-mysql
   ```

   You can also create a `.env` file in the `backend/` directory with these values.

### Database Schema

The application uses the following tables:

- **`files`**: Stores uploaded file metadata including SHA-256 hash, original filename, and S3 key
- **`ground_truths`**: Stores ground truth data in JSON format for evaluation
- **`extraction_runs`**: Stores extraction results with model information and performance metrics
- **`test_table`**: Basic table for connection testing

### Verification

To verify the setup worked correctly:

1. **Check container status**
   ```bash
   docker ps
   ```

2. **Verify tables were created**
   ```bash
   docker exec -i llm-extraction-evaluator-mysql mysql -uroot -pllm-extraction-evaluator_secure_password123 -e "USE \`llm-extraction-evaluator-ground-truth-test-mysql\`; SHOW TABLES;"
   ```

3. **Test table structure**
   ```bash
   docker exec -i llm-extraction-evaluator-mysql mysql -uroot -pllm-extraction-evaluator_secure_password123 -e "USE \`llm-extraction-evaluator-ground-truth-test-mysql\`; DESCRIBE files;"
   ```

## Troubleshooting

### Removing All Docker Containers

If you need to clean up Docker containers:

1. **Standard approach (works for most containers)**
   ```bash
   # Stop all running containers
   docker stop $(docker ps -q) 2>/dev/null || true
   
   # Remove all containers
   docker rm $(docker ps -aq) 2>/dev/null || true
   ```

2. **For stubborn containers with permission issues**
   
   Sometimes containers cannot be stopped normally due to permission issues. Here's the process we used:

   ```bash
   # Try standard removal first
   docker stop <container_id>
   docker rm <container_id>
   
   # If you get "permission denied" errors, try with sudo
   sudo docker stop <container_id>
   sudo docker rm <container_id>
   
   # If that still fails, restart Docker daemon
   sudo systemctl restart docker
   
   # Check if container is still there
   docker ps -a
   
       # If container persists, use process-level intervention
    # Get the process ID of the container and kill it in one command
    sudo kill -9 $(sudo docker inspect --format '{{.State.Pid}}' <container_id>)
    
    # Now the container should show as "Exited" and can be removed
    docker rm <container_id>
   ```

3. **Nuclear option - remove everything**
   ```bash
   # Remove all stopped containers
   docker container prune -f
   
   # Remove all unused images
   docker image prune -a -f
   
   # Remove all unused volumes
   docker volume prune -f
   ```

### Common Issues

1. **"Table doesn't exist" errors**: Make sure you've run the initialization script and the database container is running

2. **Connection refused**: Verify the container is running and the port is correctly mapped (3306:3306)

3. **"Access denied for user 'admin'" errors**: This means your environment variables aren't set correctly. The error shows the app is trying to connect with user 'admin' instead of 'llm-extraction-evaluator_user'. Make sure to:
   ```bash
   # Check your current environment variables
   echo "DB_USER: $DB_USER"
   echo "DB_PASSWORD: $DB_PASSWORD"
   echo "DB_NAME: $DB_NAME"
   
   # Set them correctly if they're empty or wrong
   export DB_USER=llm-extraction-evaluator_user
   export DB_PASSWORD=llm-extraction-evaluator_secure_password123
   export DB_NAME=llm-extraction-evaluator-ground-truth-test-mysql
   ```

4. **Permission denied on container operations**: Try using `sudo` or check if your user is in the `docker` group

5. **Data loss after container restart**: Ensure you're using the Docker volume for persistence (`-v llm-extraction-evaluator-mysql-data:/var/lib/mysql`)

6. **Environment variables not persisting**: If you're getting authentication errors after restarting your terminal, make sure to export the environment variables again or create a `.env` file in the `backend/` directory

### Specific Error Solutions

**Error: `(1146, "Table 'llm-extraction-evaluator-ground-truth-test-mysql.files' doesn't exist")`**
- Verify the database container is running: `docker ps`
- Check if tables exist: `docker exec -i llm-extraction-evaluator-mysql mysql -uroot -pllm-extraction-evaluator_secure_password123 -e "USE \`llm-extraction-evaluator-ground-truth-test-mysql\`; SHOW TABLES;"`
- If tables don't exist, re-run the initialization: `docker exec -i llm-extraction-evaluator-mysql mysql -uroot -pllm-extraction-evaluator_secure_password123 < scripts/init_db.sql`

**Error: `(1045, "Access denied for user 'admin'@'172.17.0.1' (using password: YES)")`**
- This means your app is not using the correct environment variables
- Check current variables: `echo $DB_USER $DB_PASSWORD $DB_NAME`
- Set them in your current shell session:
  ```bash
  export DB_HOST=127.0.0.1
  export DB_PORT=3306
  export DB_USER=llm-extraction-evaluator_user
  export DB_PASSWORD=llm-extraction-evaluator_secure_password123
  export DB_NAME=llm-extraction-evaluator-ground-truth-test-mysql
  ```
- Restart your application after setting the variables

## AWS S3 Configuration

If using S3 functionality, also set:

```bash
export AWS_ACCESS_KEY_ID=your_aws_access_key
export AWS_SECRET_ACCESS_KEY=your_aws_secret_key
export AWS_DEFAULT_REGION=us-east-1
export S3_BUCKET=your-s3-bucket-name
```

## Running the Application

After setting up the database and environment variables:

```bash
cd backend
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

The API will be available at `http://localhost:8000` with interactive docs at `http://localhost:8000/docs`.