#!/bin/bash -e
SAAS_CONTROL_PLANE_STACK_NAME=SaaSControlPlaneStack
SHARED_SERVICES_STACK_NAME=SharedServicesStack
echo "Testing Product Media service..."

APIGW_STAGE_NAME="prod"

echo "Get ApiGatewayUrl from the cloudformation stack"
SERVERLESS_SAAS_API_GATEWAY_URL=$(aws cloudformation describe-stacks --stack-name $SHARED_SERVICES_STACK_NAME --query "Stacks[0].Outputs[?OutputKey=='AppPlaneApiGatewayUrl'].OutputValue" --output text)
echo "API Gateway URL: $SERVERLESS_SAAS_API_GATEWAY_URL"

SERVERLESS_SAAS_API_GATEWAY_ID=$(aws cloudformation describe-stacks --stack-name $SHARED_SERVICES_STACK_NAME --query "Stacks[0].Outputs[?OutputKey=='AppPlaneApiGatewayId'].OutputValue" --output text)
echo "API Gateway Rest ID : $SERVERLESS_SAAS_API_GATEWAY_ID"

echo "Get user pool id from the cloudformation stack"
TENANT_USERPOOL_ID=$(aws cloudformation describe-stacks --stack-name $SHARED_SERVICES_STACK_NAME --query "Stacks[0].Outputs[?OutputKey=='TenantUserpoolId'].OutputValue" --output text)
echo "User pool id: $TENANT_USERPOOL_ID"

echo "Get user pool client id from the cloudformation stack"
TENANT_USERPOOL_CLIENT_ID=$(aws cloudformation describe-stacks --stack-name $SHARED_SERVICES_STACK_NAME --query "Stacks[0].Outputs[?OutputKey=='TenantUserPoolClientId'].OutputValue" --output text)
echo "User pool client id: $TENANT_USERPOOL_CLIENT_ID"

# Get the tenants with features containing MediaService
# filtering only tenants with MediaService attribute

echo "Get DYNAMO_DB_TABLE from the cloudformation stack"
DYNAMO_DB_TABLE=$(aws cloudformation describe-stacks --stack-name $SAAS_CONTROL_PLANE_STACK_NAME --query "Stacks[0].Outputs[?OutputKey=='ControlPlaneTenantDetailsTable'].OutputValue" --output text)
echo "DYNAMO_DB_TABLE name: $DYNAMO_DB_TABLE"

TENANT_IDS=($(aws dynamodb scan --table-name $DYNAMO_DB_TABLE --filter-expression 'contains(features, :featureValue)' --expression-attribute-values '{":featureValue":{"S":"MediaService"}}' --projection-expression "tenantId" --output json | jq -r '.Items[].tenantId.S'))
# Print the array
echo "List of Tenants with MediaService feature"
echo "${TENANT_IDS[@]}"
# Initialize an empty array to store all users
TENANT_USER_ARRAY=()

# Iterate through each tenant ID
for tenant_id in "${TENANT_IDS[@]}"
do
    echo "Getting users for tenant: $tenant_id"
     # Get users for this tenant and add them to TENANT_USER_ARRAY array
    users=($(aws cognito-idp list-users-in-group --user-pool-id $TENANT_USERPOOL_ID --group-name $tenant_id --query 'Users[].Username' --output json | jq -r '.[]'))
    # Add users to the TENANT_USER_ARRAY array
    TENANT_USER_ARRAY+=("${users[@]}")
    echo "Added ${#users[@]} users from tenant $tenant_id"
    echo "-------------------"
done
# Print the total number of users
echo "Total number of users across all tenants: ${#TENANT_USER_ARRAY[@]}"
for TENANT_USER in "${TENANT_USER_ARRAY[@]}"; do
  echo "Creating data for Test User: $TENANT_USER"

  TENANT_TOKEN=$(aws cognito-idp admin-initiate-auth \
    --user-pool-id $TENANT_USERPOOL_ID \
    --auth-flow ADMIN_USER_PASSWORD_AUTH \
    --client-id $TENANT_USERPOOL_CLIENT_ID \
    --auth-parameters USERNAME=$TENANT_USER,PASSWORD='#CostPerTenant1234' \
    --query 'AuthenticationResult.IdToken' \
    --output text)

  TENANT_ID=$(echo "$TENANT_USER" | sed 's/tenant-admin-//')
  echo "Uploading media to S3 for TENANT_ID: ${TENANT_ID}"

  ITERATOR=5
  for i in $(seq 1 $ITERATOR); do
    PRODUCT_ID="product-${i}"

    # Assign different media file for each iteration
    if [ $i -eq 1 ]; then
      MEDIA_FILE="test-text.txt"
      DOWNLOAD_FILE="test-text.txt"
    elif [ $i -eq 2 ]; then
      MEDIA_FILE="test-audio.mp4"
      DOWNLOAD_FILE="test-audio.mp4"
    elif [ $i -eq 3 ]; then
      MEDIA_FILE="test-image.png"
      DOWNLOAD_FILE="test-image.png"
    fi
  
    FILE_PATH="file=@${PWD}/resources/${MEDIA_FILE}"

    echo "Getting Product Media"
    echo "======================================"
    url="${SERVERLESS_SAAS_API_GATEWAY_URL}productmedia/${PRODUCT_ID}/${MEDIA_FILE}"
    echo "url: ${url}"

    CURL_RESPONSE=$(curl --request POST \
      --url "${SERVERLESS_SAAS_API_GATEWAY_URL}productmedia" \
      --header "Authorization: Bearer ${TENANT_TOKEN}" \
      --header 'x-service-identifier: ProductMediaServices' \
      --header "tenantId: ${TENANT_ID}" \
      --header "productId: ${PRODUCT_ID}" \
      -F $FILE_PATH)
    echo "POST method call completed:: $CURL_RESPONSE"

    sleep 5

    CURL_RESPONSE=$(curl --request GET \
      --url $url \
      --header "Authorization: Bearer ${TENANT_TOKEN}" \
      --header 'x-service-identifier: ProductMediaServices' \
      --header "tenantId: ${TENANT_ID}" \
      --header "productId: ${PRODUCT_ID}" \
      --output "resources/$(echo "$TENANT_ID" | cut -c 1-8)_${PRODUCT_ID}_${DOWNLOAD_FILE}")
    sleep 5
    echo "GET method call completed:: Successfully downloaded the media file- ${PRODUCT_ID}_${DOWNLOAD_FILE}"
    sleep 2

  done
done