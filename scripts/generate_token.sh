#!/bin/bash

# Script to generate authentication token
# Usage: source ./generate_token.sh

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Check if the script is being sourced
(return 0 2>/dev/null) || { printf "\n${RED}ERROR:${NC} You must source this script: ${YELLOW}source ./scripts/generate_token.sh${NC}\n\n"; exit 1; }

# Check for jq
if ! command -v jq &> /dev/null; then
    printf "${RED}jq is required but not installed.${NC} Please install jq (e.g., sudo apt install jq) and try again.\n"
    return 1
fi

# Check required environment variables
required_vars=("OAUTH_TOKEN_URL" "OAUTH_CLIENT_ID" "OAUTH_CLIENT_SECRET")
missing_vars=()

for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
        missing_vars+=("$var")
    fi
done

if [ ${#missing_vars[@]} -ne 0 ]; then
    printf "${RED}Error:${NC} The following required environment variables are not set:\n"
    for var in "${missing_vars[@]}"; do
        printf "  - ${YELLOW}%s${NC}\n" "$var"
    done
    printf "\nPlease set these variables and try again.\n"
    printf "You may need to run: ${YELLOW}source .env${NC}\n"
    return 1
fi

# Generate token
printf "${CYAN}Generating OAuth token...${NC}\n"

response=$(curl -s -X POST "$OAUTH_TOKEN_URL" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=client_credentials" \
    -d "client_id=$OAUTH_CLIENT_ID" \
    -d "client_secret=$OAUTH_CLIENT_SECRET")

# Check if curl command was successful
if [ $? -ne 0 ]; then
    printf "${RED}Error:${NC} Failed to connect to token endpoint\n"
    return 1
fi

# Extract token using jq
token=$(echo "$response" | jq -r '.access_token')

# Check if token was successfully extracted
if [ "$token" = "null" ] || [ -z "$token" ]; then
    printf "${RED}Error:${NC} Failed to get token. Response:\n%s\n" "$response"
    return 1
fi

# Export the token
export OAUTH_TOKEN="$token"

printf "${GREEN}Token generated successfully!${NC}\n"
printf "${CYAN}Token is now available as:${NC} ${YELLOW}OAUTH_TOKEN${NC}\n\n"

# Optional: Save token to a file
if [ -d ".env" ]; then
    echo "OAUTH_TOKEN=$token" >> .env
    printf "${GREEN}Token has been added to .env file${NC}\n"
fi 