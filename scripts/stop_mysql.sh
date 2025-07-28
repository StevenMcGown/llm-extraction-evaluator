#!/bin/bash

# Script to stop MySQL container by finding PID and killing it

echo "Finding MySQL container..."

# Get the container ID
CONTAINER_ID=$(docker ps -q --filter "name=llm-extraction-evaluator-mysql")

if [ -z "$CONTAINER_ID" ]; then
    echo "MySQL container not found or not running"
    exit 1
fi

echo "Found container ID: $CONTAINER_ID"

# Get the PID of the container
PID=$(docker inspect --format '{{.State.Pid}}' $CONTAINER_ID)

if [ -z "$PID" ] || [ "$PID" = "0" ]; then
    echo "Could not get PID for container"
    exit 1
fi

echo "Container PID: $PID"

# Kill the process
echo "Killing process $PID..."
sudo kill -9 $PID

# Force remove the container
echo "Force removing container..."
docker rm -f $CONTAINER_ID

echo "MySQL container stopped and removed."
echo "To start fresh, run: docker-compose up mysql" 