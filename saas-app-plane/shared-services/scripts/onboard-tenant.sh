#!/bin/bash -e

#!/bin/bash

# Function to display usage instructions
usage() {
    echo "Usage: $0 <TENANT_EMAIL> <TENANT_NAME> <FEATURES>"
    echo
    echo "Parameters:"
    echo "  TENANT_EMAIL  - Email address of the tenant"
    echo "  TENANT_NAME   - Name of the tenant"
    echo "  FEATURES      - Features to be enabled for the tenant example 'ProductService, MediaService, ReviewService'"
    echo
    echo "Example:"
    echo "  $0 user@example.com \"Acme Corp\" \"MediaService,ProductService\""
}

# Check if exactly 3 arguments are provided
if [ $# -ne 3 ]; then
    echo "Error: Incorrect number of arguments." >&2
    usage
    exit 1
fi

# Assign command line arguments to variables
TENANT_EMAIL="$1"
TENANT_NAME="$2"
FEATURES="$3"

# Proceed with the rest of the script
echo "Proceeding with tenant onboarding..."
echo "Tenant Email: $TENANT_EMAIL"
echo "Tenant Name: $TENANT_NAME"
echo "Features: $FEATURES"

# Tenant Onboarding logic goes here
# Code to generate a random password with Alpha Numeric and one symbol character
PASSWORD=$(openssl rand -base64 8 | sed 's/[\/+=]/#/g')
# add small & capital letter, digit and symbol to ensure to meet password policy
PASSWORD=$PASSWORD'aB#9'
echo "Generated Password: $PASSWORD"
CONTROL_PLANE_STACK_NAME="SaaSControlPlaneStack"
CLIENT_ID=$(aws cloudformation describe-stacks --stack-name $CONTROL_PLANE_STACK_NAME --query "Stacks[0].Outputs[?OutputKey=='ControlPlaneIdpDetails'].OutputValue" | jq -r '.[0]' | jq -r '.idp.clientId')
USER_POOL_ID=$(aws cloudformation describe-stacks --stack-name $CONTROL_PLANE_STACK_NAME --query "Stacks[0].Outputs[?OutputKey=='ControlPlaneIdpDetails'].OutputValue" | jq -r '.[0]' | jq -r '.idp.userPoolId')
USER="admin"

# required in order to initiate-auth
UPDATE_USER=$(aws cognito-idp update-user-pool-client \
    --user-pool-id "$USER_POOL_ID" \
    --client-id "$CLIENT_ID" \
    --explicit-auth-flows USER_PASSWORD_AUTH)
echo "Updated user pool client: $UPDATE_USER"

# remove need for password reset
UPDATE_USER_PWD=$(aws cognito-idp admin-set-user-password \
    --user-pool-id "$USER_POOL_ID" \
    --username "$USER" \
    --password "$PASSWORD" \
    --permanent)
echo "Updated user password: $UPDATE_USER_PWD"

# get credentials for user
AUTHENTICATION_RESULT=$(aws cognito-idp initiate-auth \
    --auth-flow USER_PASSWORD_AUTH \
    --client-id "${CLIENT_ID}" \
    --auth-parameters "USERNAME=${USER},PASSWORD='${PASSWORD}'" \
    --query 'AuthenticationResult')

ID_TOKEN=$(echo "$AUTHENTICATION_RESULT" | jq -r '.IdToken')

CONTROL_PLANE_API_ENDPOINT=$(aws cloudformation describe-stacks \
    --stack-name "$CONTROL_PLANE_STACK_NAME" \
    --query "Stacks[0].Outputs[?contains(OutputKey,'controlPlaneAPIEndpoint')].OutputValue" \
    --output text)

DATA=$(jq --null-input \
    --arg tenantName "$TENANT_NAME" \
    --arg tenantEmail "$TENANT_EMAIL" \
    --arg features "$FEATURES" \
    '{
"tenantName": $tenantName,
"email": $tenantEmail,
"tenantTier": "basic",
"tenantStatus": "In progress",
"features": $features
}')

echo "creating tenant..."
curl --request POST \
    --url "${CONTROL_PLANE_API_ENDPOINT}tenants" \
    --header "Authorization: Bearer ${ID_TOKEN}" \
    --header 'content-type: application/json' \
    --data "$DATA"
echo "" # add newline    
            
echo "retrieving tenants..."
    curl --request GET \
        --url "${CONTROL_PLANE_API_ENDPOINT}tenants" \
        --header "Authorization: Bearer ${ID_TOKEN}" \
        --silent | jq