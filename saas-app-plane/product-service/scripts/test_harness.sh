#!/bin/bash -e
SAAS_CONTROL_PLANE_STACK_NAME=SaaSControlPlaneStack
SHARED_SERVICES_STACK_NAME=SharedServicesStack
echo "Testing Product and Order service"

echo "Get ApiGatewayUrl from the cloudformation stack"
SERVERLESS_SAAS_API_GATEWAY_URL=$(aws cloudformation describe-stacks --stack-name $SHARED_SERVICES_STACK_NAME --query "Stacks[0].Outputs[?OutputKey=='AppPlaneApiGatewayUrl'].OutputValue" --output text)
echo "api gateway url: $SERVERLESS_SAAS_API_GATEWAY_URL"

echo "Get user pool id from the cloudformation stack"
TENANT_USERPOOL_ID=$(aws cloudformation describe-stacks --stack-name $SHARED_SERVICES_STACK_NAME --query "Stacks[0].Outputs[?OutputKey=='TenantUserpoolId'].OutputValue" --output text)
echo "User pool id: $TENANT_USERPOOL_ID"

echo "Get user pool client id from the cloudformation stack"
TENANT_USERPOOL_CLIENT_ID=$(aws cloudformation describe-stacks --stack-name $SHARED_SERVICES_STACK_NAME --query "Stacks[0].Outputs[?OutputKey=='TenantUserPoolClientId'].OutputValue" --output text)
echo "User pool client id: $TENANT_USERPOOL_CLIENT_ID"

# Get the tenants with features containing ProductService
# filtering only tenants with ProductService attribute

echo "Get DYNAMO_DB_TABLE from the cloudformation stack"
DYNAMO_DB_TABLE=$(aws cloudformation describe-stacks --stack-name $SAAS_CONTROL_PLANE_STACK_NAME --query "Stacks[0].Outputs[?OutputKey=='ControlPlaneTenantDetailsTable'].OutputValue" --output text)
echo "DYNAMO_DB_TABLE name: $DYNAMO_DB_TABLE"

TENANT_IDS=($(aws dynamodb scan --table-name $DYNAMO_DB_TABLE --filter-expression 'contains(features, :featureValue)' --expression-attribute-values '{":featureValue":{"S":"ProductService"}}' --projection-expression "tenantId" --output json | jq -r '.Items[].tenantId.S'))
# Print the array
echo "List of Tenants with ProductService feature"
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
# loop through the users
for TENANT_USER in "${TENANT_USER_ARRAY[@]}"; do
  echo "Creating data for Test User: $TENANT_USER"
  TENANT_TOKEN=$(aws cognito-idp admin-initiate-auth \
    --user-pool-id $TENANT_USERPOOL_ID \
    --auth-flow ADMIN_USER_PASSWORD_AUTH \
    --client-id $TENANT_USERPOOL_CLIENT_ID \
    --auth-parameters USERNAME=$TENANT_USER,PASSWORD='#CostPerTenant1234' \
    --query 'AuthenticationResult.IdToken' \
    --output text)

  ITERATOR=5

  # Create products
  for i in $(seq 1 $ITERATOR); do
    echo "Adding product $i"
    curl --request POST \
      --url "${SERVERLESS_SAAS_API_GATEWAY_URL}product" \
      --header "Authorization: Bearer ${TENANT_TOKEN}" \
      --header 'x-service-identifier: ProductService' \
      --header 'content-type: application/json' \
      --data "{\"name\":\"Product-$i\",\"price\":$i,\"sku\":\"1\",\"category\":\"category-$i\"}"
      echo
  done

  # Get all products
  response=$(curl -s --request GET \
    --url "${SERVERLESS_SAAS_API_GATEWAY_URL}product" \
    --header "Authorization: Bearer ${TENANT_TOKEN}" \
    --header 'x-service-identifier: ProductService' \
    --header 'content-type: application/json')

  echo "Success GET all products: ${response}"

  # Parse the JSON response and loop through each product
  echo "$response" | jq -c '.[]' | while read -r product; do
    shard_id=$(echo "$product" | jq -r '.shardId')
    product_id=$(echo "$product" | jq -r '.productId')
    shard_product="${shard_id}:${product_id}"

    # Get and update each product
    echo "GET product: ${shard_product}"
    
    product_response=$(curl -s --request GET \
      --url "${SERVERLESS_SAAS_API_GATEWAY_URL}product/${shard_product}" \
      --header "Authorization: Bearer ${TENANT_TOKEN}" \
      --header 'x-service-identifier: ProductService' \
      --header 'content-type: application/json')
    # Extract properties from the product response
    product_name=$(echo "$product_response" | jq -r '.name')
    updated_name="${product_name}-updated"

    echo "PUT product: ${shard_product}"
    curl --request PUT \
      --url "${SERVERLESS_SAAS_API_GATEWAY_URL}product/${shard_product}" \
      --header "Authorization: Bearer ${TENANT_TOKEN}" \
      --header 'x-service-identifier: ProductService' \
      --header 'content-type: application/json' \
      --data "{\"name\":\"${updated_name}\",\"price\":100,\"sku\":\"2\",\"category\":\"category-update\"}"
  done

  # Create orders
  for i in $(seq 1 $ITERATOR); do
    echo "Creating order $i"
    order_response=$(curl -s --request POST \
      --url "${SERVERLESS_SAAS_API_GATEWAY_URL}order" \
      --header "Authorization: Bearer ${TENANT_TOKEN}" \
      --header 'x-service-identifier: ProductService' \
      --header 'content-type: application/json' \
      --data "{\"orderName\":\"test order\",\"orderProducts\": [{ \"productId\":\"$i\", \"quantity\":2 }]}")

    order_id=$(echo "$order_response" | jq -r '.orderId')
    echo "Order created: $order_id"
  done

  # Get all orders
  echo "Getting all orders"
  orders_response=$(curl -s --request GET \
    --url "${SERVERLESS_SAAS_API_GATEWAY_URL}order" \
    --header "Authorization: Bearer ${TENANT_TOKEN}" \
    --header 'x-service-identifier: ProductService' \
    --header 'content-type: application/json')

  echo "Success GET all orders: ${orders_response}"

  # Parse the JSON response and loop through each order
  echo "$orders_response" | jq -c '.[]' | while read -r order; do
    key=$(echo "$key" | jq -r '.key')

    # Get and update each order
    echo "GET order: ${key}"
    curl --request GET \
      --url "${SERVERLESS_SAAS_API_GATEWAY_URL}order/${key}" \
      --header "Authorization: Bearer ${TENANT_TOKEN}" \
      --header 'x-service-identifier: ProductService' \
      --header 'content-type: application/json'
    echo    
  done
done