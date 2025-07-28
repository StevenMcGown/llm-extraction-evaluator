#!/bin/bash

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Check if the script is being sourced
(return 0 2>/dev/null) || { printf "\n${RED}ERROR:${NC} You must source this script: ${YELLOW}source ./scripts/login.sh${NC}\n\n"; exit 1; }

# Check for jq
if ! command -v jq &> /dev/null; then
    printf "${RED}jq is required but not installed.${NC} Please install jq (e.g., sudo apt install jq) and try again.\n"
    return 1
fi

# List all profiles into an array (in memory)
mapfile -t profiles < <(aws configure list-profiles)

printf "${CYAN}\n==================== AWS PROFILE SELECTION ====================${NC}\n"
for i in "${!profiles[@]}"; do
    index=$((i + 1))
    printf "  ${YELLOW}%s)${NC} %s\n" "$index" "${profiles[$i]}"
done

printf "${CYAN}Enter the number of the profile you want to login to:${NC} "
read choice

if ! [[ "$choice" =~ ^[0-9]+$ ]]; then
    printf "${RED}Invalid choice${NC}\n"
    return 1
fi
if [ "$choice" -lt 1 ] || [ "$choice" -gt "${#profiles[@]}" ]; then
    printf "${RED}Invalid choice${NC}\n"
    return 1
fi
profile="${profiles[$((choice-1))]}"

printf "\n${CYAN}Logging in to profile:${NC} ${YELLOW}%s${NC}...\n" "$profile"
aws sso login --profile $profile
if [ $? -eq 0 ]; then
    printf "${GREEN}Login successful${NC}\n"
else
    printf "${RED}Login failed${NC}\n"
    return 1
fi

export AWS_PROFILE=$profile
aws sts get-caller-identity --profile $profile > /dev/null

cache_file=$(find ~/.aws/cli/cache -type f -printf "%T@ %p\n" | sort -n | tail -1 | cut -d' ' -f2)
if [ -z "$cache_file" ]; then
    printf "${RED}Could not find AWS CLI cache file with credentials.${NC}\n"
    return 1
fi

export AWS_ACCESS_KEY_ID=$(jq -r .Credentials.AccessKeyId "$cache_file")
export AWS_SECRET_ACCESS_KEY=$(jq -r .Credentials.SecretAccessKey "$cache_file")
export AWS_SESSION_TOKEN=$(jq -r .Credentials.SessionToken "$cache_file")
export AWS_REGION=$(aws configure get region --profile $profile)

mkdir -p ~/.aws
cat > ~/.aws/credentials << EOF
[$profile]
aws_access_key_id = $AWS_ACCESS_KEY_ID
aws_secret_access_key = $AWS_SECRET_ACCESS_KEY
aws_session_token = $AWS_SESSION_TOKEN
region = $AWS_REGION
EOF

printf "\n${CYAN}AWS PROFILE SET:${NC} ${YELLOW}%s${NC}\n" "$AWS_PROFILE"

printf "${CYAN}Testing S3 access...${NC}\n"
aws s3 ls --profile $profile

if [ -f .env ]; then
    source .env
fi

printf "\n${CYAN}==================== ENVIRONMENT VARIABLES ====================${NC}\n"
printf "%-30s %s\n" "OPENAI_API_KEY:" "${OPENAI_API_KEY:-<not set>}"
printf "%-30s %s\n" "OAUTH_TOKEN_URL:" "${OAUTH_TOKEN_URL:-<not set>}"
printf "%-30s %s\n" "OAUTH_CLIENT_ID:" "${OAUTH_CLIENT_ID:-<not set>}"
printf "%-30s %s\n" "OAUTH_CLIENT_SECRET:" "${OAUTH_CLIENT_SECRET:-<not set>}"
printf "%-30s %s\n" "AWS_ACCESS_KEY_ID:" "${AWS_ACCESS_KEY_ID:-<not set>}"
printf "%-30s %s\n" "AWS_SECRET_ACCESS_KEY:" "${AWS_SECRET_ACCESS_KEY:-<not set>}"
printf "%-30s %s\n" "AWS_SESSION_TOKEN:" "${AWS_SESSION_TOKEN:-<not set>}"
printf "%-30s %s\n" "AWS_REGION:" "${AWS_REGION:-<not set>}"
printf "%-30s %s\n" "AWS_PROFILE:" "${AWS_PROFILE:-<not set>}"

printf "${GREEN}\n✅ AWS credentials and environment variables are now available in your shell.${NC}\n"
printf "${CYAN}You can now run:${NC} ${YELLOW}docker compose up --build${NC}\n\n"