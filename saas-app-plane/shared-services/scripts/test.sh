#!/bin/bash -e

STACK_NAME=SharedServicesStack
echo "Testing User Management Services"

echo "Get AppPlaneApiGatewayUrl from the cloudformation stack"
API_GATEWAY_URL=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --query "Stacks[0].Outputs[?OutputKey=='AppPlaneApiGatewayUrl'].OutputValue" --output text)
echo "api gateway url: $API_GATEWAY_URL"

echo "Get user pool id from the cloudformation stack"
TENANT_USERPOOL_ID=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --query "Stacks[0].Outputs[?OutputKey=='TenantUserpoolId'].OutputValue" --output text)
echo "User pool id: $TENANT_USERPOOL_ID"

echo "Get user pool client id from the cloudformation stack"
TENANT_USERPOOL_CLIENT_ID=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --query "Stacks[0].Outputs[?OutputKey=='TenantUserPoolClientId'].OutputValue" --output text)
echo "User pool client id: $TENANT_USERPOOL_CLIENT_ID"

TENANT_ADMIN_ARRAY=$(aws cognito-idp list-users --user-pool-id $TENANT_USERPOOL_ID  | jq -r ".Users[].Username")
echo $TENANT_ADMIN_ARRAY

# loop through the users
for TENANT_ADMIN in $TENANT_ADMIN_ARRAY; do
  echo "User: $TENANT_ADMIN"
  
  echo "Login with tenant $TENANT_ADMIN"
  TENANT_TOKEN=$(aws cognito-idp admin-initiate-auth \
    --user-pool-id $TENANT_USERPOOL_ID \
      --auth-flow ADMIN_USER_PASSWORD_AUTH \
      --client-id $TENANT_USERPOOL_CLIENT_ID \
      --auth-parameters USERNAME=$TENANT_ADMIN,PASSWORD='#CostPerTenant1234' \
      --query 'AuthenticationResult.IdToken' \
      --output text)

  curl "${API_GATEWAY_URL}/user" \
    -H "accept: application/json, text/plain, */*" \
    -H "authorization: Bearer ${TENANT_TOKEN}"
done

