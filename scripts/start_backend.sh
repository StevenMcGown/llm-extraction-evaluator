#!/usr/bin/env bash
# Helper script to prep local shell for running the backend
# 1. Load environment variables from the project .env file (if present)
# 2. Launch the interactive AWS SSO profile selector (scripts/login.sh)
# 3. Start database services via docker-compose
# 4. Start FastAPI backend
#
# Usage:
#   source ./scripts/start_backend.sh
#
# NOTE: This script must be *sourced* so that the exported variables remain
#       in your current shell session.

# Ensure the script is being sourced
(return 0 2>/dev/null) || { echo "🔴  Please run: source ./scripts/start_backend.sh"; exit 1; }

SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# 1) Load .env at repo root if it exists
ENV_FILE="$PROJECT_ROOT/.env"
if [ -f "$ENV_FILE" ]; then
  echo "🔄  Loading environment from $ENV_FILE"
  # shellcheck disable=SC1090
  source "$ENV_FILE"
else
  echo "⚠️   No .env file found at project root"
fi

# Also check for .env in backend directory
BACKEND_ENV_FILE="$PROJECT_ROOT/backend/.env"
if [ -f "$BACKEND_ENV_FILE" ]; then
  echo "🔄  Loading environment from $BACKEND_ENV_FILE"
  # shellcheck disable=SC1090
  source "$BACKEND_ENV_FILE"
fi

# Source AWS login helper to set credentials
source "$SCRIPT_DIR/login.sh"

# 2) Start database services via docker-compose
echo "🐳  Starting database services with docker-compose"
pushd "$PROJECT_ROOT" >/dev/null || exit 1

# Check if docker-compose is available
if ! command -v docker-compose &> /dev/null; then
  echo "🔴  docker-compose not found. Please install docker-compose first."
  return 1
fi

# Start MySQL container
echo "📊  Starting MySQL container..."
docker-compose up -d mysql

# Wait for MySQL to be healthy
echo "⏳  Waiting for MySQL to be ready..."
timeout=60
while [ $timeout -gt 0 ]; do
  if docker-compose ps mysql | grep -q "healthy"; then
    echo "✅  MySQL is healthy and ready"
    break
  fi
  echo "⏳  Waiting for MySQL... ($timeout seconds remaining)"
  sleep 5
  timeout=$((timeout - 5))
done

if [ $timeout -le 0 ]; then
  echo "🔴  MySQL failed to start within 60 seconds"
  return 1
fi

# Verify database tables exist
echo "🔍  Verifying database tables..."
if docker exec llm-extraction-evaluator-mysql mysql -uadmin -ppassword -e "USE \`llm-extraction-evaluator-ground-truth-test-mysql\`; SHOW TABLES;" 2>/dev/null | grep -q "files"; then
  echo "✅  Database tables are ready"
else
  echo "⚠️   Database tables not found. Running initialization script..."
  docker exec -i llm-extraction-evaluator-mysql mysql -uadmin -ppassword < "$PROJECT_ROOT/scripts/init_db.sql"
  echo "✅  Database initialization complete"
fi

popd >/dev/null

# 3) Ensure Python virtual environment is active (backend/venv or backend/.venv)
if [ -z "$VIRTUAL_ENV" ]; then
  VENV_PATH="${PROJECT_ROOT}/backend/venv"
  [ -d "$VENV_PATH" ] || VENV_PATH="${PROJECT_ROOT}/backend/.venv"

  if [ ! -d "$VENV_PATH" ]; then
    echo "🐍  Creating virtual environment at $VENV_PATH"
    python -m venv "$VENV_PATH" || { echo "Failed to create venv"; return 1; }
  fi

  echo "🔑  Activating virtual environment $VENV_PATH"
  # shellcheck disable=SC1090
  source "$VENV_PATH/bin/activate"

  echo "📦  Installing backend requirements"
  pip install --quiet -r "$PROJECT_ROOT/backend/requirements.txt"
fi

# 4) Optionally pull ground-truth and source files from S3
if [ -n "$GROUND_TRUTH_S3" ]; then
  DEST="$PROJECT_ROOT/test_data/ground_truth"
  mkdir -p "$DEST"
  echo "⬇️   Syncing ground-truth data from $GROUND_TRUTH_S3 to $DEST"
  aws s3 sync "$GROUND_TRUTH_S3" "$DEST" --no-progress || echo "⚠️  Failed to sync ground truth data"
fi

if [ -n "$SOURCE_S3" ]; then
  DEST="$PROJECT_ROOT/test_data/source_files"
  mkdir -p "$DEST"
  echo "⬇️   Syncing source files from $SOURCE_S3 to $DEST"
  aws s3 sync "$SOURCE_S3" "$DEST" --no-progress || echo "⚠️  Failed to sync source files"
fi

# 6) Start FastAPI backend with Uvicorn (development mode)
echo "🚀  Starting FastAPI backend (auto-reload enabled)"
pushd "$PROJECT_ROOT/backend" >/dev/null || exit 1
uvicorn main:app --reload
popd >/dev/null 