#!/bin/bash -e

PASSWORD="#CostPerTenant1234"

CONTROL_PLANE_STACK_NAME="SaaSControlPlaneStack"

CLIENT_ID=$(aws cloudformation describe-stacks --stack-name $CONTROL_PLANE_STACK_NAME --query "Stacks[0].Outputs[?OutputKey=='ControlPlaneIdpDetails'].OutputValue" | jq -r '.[0]' | jq -r '.idp.clientId')
USER_POOL_ID=$(aws cloudformation describe-stacks --stack-name $CONTROL_PLANE_STACK_NAME --query "Stacks[0].Outputs[?OutputKey=='ControlPlaneIdpDetails'].OutputValue" | jq -r '.[0]' | jq -r '.idp.userPoolId')
USER="admin"

# required in order to initiate-auth
aws cognito-idp update-user-pool-client \
    --user-pool-id "$USER_POOL_ID" \
    --client-id "$CLIENT_ID" \
    --explicit-auth-flows USER_PASSWORD_AUTH

# remove need for password reset
aws cognito-idp admin-set-user-password \
    --user-pool-id "$USER_POOL_ID" \
    --username "$USER" \
    --password "$PASSWORD" \
    --permanent

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

# CREATE A LOOP IN BASH THAT LOOPS THREE TIMES
for i in {1..3}; do
    TENANT_NAME="tenant${i}"
    TENANT_EMAIL="shaanubh+tenant${i}@amazon.com"

    DATA=$(jq --null-input \
        --arg tenantName "$TENANT_NAME" \
        --arg tenantEmail "$TENANT_EMAIL" \
        '{
    "tenantName": $tenantName,
    "email": $tenantEmail,
    "tenantTier": "basic",
    "tenantStatus": "In progress"
    }')

    echo "creating tenant..."
    curl --request POST \
        --url "${CONTROL_PLANE_API_ENDPOINT}tenants" \
        --header "Authorization: Bearer ${ID_TOKEN}" \
        --header 'content-type: application/json' \
        --data "$DATA"
    echo "" # add newline    
done            
    
echo "retrieving tenants..."
    curl --request GET \
        --url "${CONTROL_PLANE_API_ENDPOINT}tenants" \
        --header "Authorization: Bearer ${ID_TOKEN}" \
        --silent | jq
