#!/bin/bash -e

SAAS_CONTROL_PLANE_STACK_NAME=SaaSControlPlaneStack
SHARED_SERVICES_STACK_NAME=SharedServicesStack
echo "Testing Product Review service..."

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
# Sample review description, the product is fictional and doesn't exist, this is large so to generate load on database
REVIEW_DESCRIPTION1="I recently upgraded to the CleanSweep Pro Vacuum Cleaner, and it is been a significant improvement over my old vacuum. The suction power is impressive, effortlessly picking up dirt, dust, and pet hair. The design is sleek and ergonomic, making it easy to maneuver around furniture. The vacuum is also surprisingly quiet, especially considering its powerful performance. One feature that really stands out is the advanced filtration system, which captures 99.9% of dust and allergens. This has been a game-changer for my allergies. The included attachments are also useful, particularly the crevice tool and upholstery brush. My only minor complaint is that the cord could be longer. Overall, the CleanSweep Pro Vacuum Cleaner is an excellent choice for anyone seeking a reliable, high-performance vacuum. The price may be slightly higher than some competitors, but the quality and performance justify the investment."

REVIEW_DESCRIPTION2="I have tried several wireless headphones in the past, but the AudioBliss Wireless Headphones have blown me away. The sound quality is exceptional, with crisp highs and deep bass. The noise cancellation is also impressive, effectively blocking out background noise. The design is stylish and comfortable, with soft ear cushions and an adjustable headband. The headphones are also incredibly lightweight, making them perfect for long listening sessions. I have been using these headphones for music, podcasts, and phone calls, and the sound quality has consistently impressed. The battery life is also remarkable, lasting up to 12 hours on a single charge. One feature I appreciate is the quick pairing process. The headphones connect seamlessly to my phone or laptop, and the controls are intuitive. My only minor complaint is that the carrying case could be more durable. Overall, the AudioBliss Wireless Headphones are a phenomenal choice for anyone seeking high-quality sound and comfort. The price may be slightly higher than some competitors, but trust me, it is worth every penny."

REVIEW_DESCRIPTION3="I have been using the FitMax Pro Smartwatch for about three weeks now, and I must say, it is been a game-changer. The design is sleek and modern, and the touchscreen interface is incredibly responsive. The watch is comfortable to wear, even during workouts, and the strap is easily adjustable. The fitness tracking features are impressive, with accurate step tracking, distance measurement, and heart rate monitoring. I particularly love the built-in GPS, which allows me to track my runs and hikes without needing my phone. The battery life is also impressive, lasting up to 5 days on a single charge. One feature that really stands out is the integration with my smartphone. I can receive notifications, control my music, and even respond to texts directly from the watch. The only downside is that the watch can be a bit slow to sync with my phone at times. Overall, I am thoroughly impressed with the FitMax Pro Smartwatch. It is a fantastic value for the price, and I would highly recommend it to anyone looking for a reliable and feature-rich smartwatch."

REVIEW_DESCRIPTION4="I recently upgraded to the CleanSweep Pro Vacuum Cleaner, and it has been a significant improvement over my old vacuum. The suction power is impressive, effortlessly picking up dirt, dust, and pet hair. The design is sleek and ergonomic, making it easy to maneuver around furniture. The vacuum is also surprisingly quiet, especially considering its powerful performance. One feature that really stands out is the advanced filtration system, which captures 99.9% of dust and allergens. This has been a game-changer for my allergies. The included attachments are also useful, particularly the crevice tool and upholstery brush. My only minor complaint is that the cord could be longer. Overall, the CleanSweep Pro Vacuum Cleaner is an excellent choice for anyone seeking a reliable, high-performance vacuum. The price may be slightly higher than some competitors, but the quality and performance justify the investment"

REVIEW_DESCRIPTION5="I recently purchased the Pulse Performance Laptop for work and gaming, and I am thoroughly impressed. The laptops Intel Core i7 processor and 16GB RAM provide lightning-fast performance, handling demanding tasks with ease. The 15.6-inch display is vibrant and crisp, with excellent color accuracy. The keyboard is also comfortable to type on, with a responsive touchpad."

# Get the tenants with features containing ReviewService
# filtering only tenants with ReviewService attribute

echo "Get DYNAMO_DB_TABLE from the cloudformation stack"
DYNAMO_DB_TABLE=$(aws cloudformation describe-stacks --stack-name $SAAS_CONTROL_PLANE_STACK_NAME --query "Stacks[0].Outputs[?OutputKey=='ControlPlaneTenantDetailsTable'].OutputValue" --output text)
echo "DYNAMO_DB_TABLE name: $DYNAMO_DB_TABLE"

TENANT_IDS=($(aws dynamodb scan --table-name $DYNAMO_DB_TABLE --filter-expression 'contains(features, :featureValue)' --expression-attribute-values '{":featureValue":{"S":"ReviewService"}}' --projection-expression "tenantId" --output json | jq -r '.Items[].tenantId.S'))
# Print the array
echo "List of Tenants with ReviewService feature"
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
TEMP_TENANT_PASSWORD='#CostPerTenant1234'
# loop through the users
for TENANT_USER in "${TENANT_USER_ARRAY[@]}"; do
  echo "Creating data for Test User: $TENANT_USER"
  # get the password from the aws secrets manager
  # Attempt to retrieve the secret value
  if ! TENANT_PASSWORD=$(aws secretsmanager get-secret-value --secret-id "$TENANT_USER" --query 'SecretString' --output text 2>&1); then
      # Check for specific error conditions
      if echo "$TENANT_PASSWORD" | grep -q "ResourceNotFoundException"; then
          echo "Secret not found. Please check the secret name and ensure it exists."
          TENANT_PASSWORD=$TEMP_TENANT_PASSWORD
      elif echo "$TENANT_PASSWORD" | grep -q "AccessDeniedException"; then
          echo "Access denied. Please check your IAM permissions."
          TENANT_PASSWORD=$TEMP_TENANT_PASSWORD
      elif echo "$TENANT_PASSWORD" | grep -q "InvalidParameterException"; then
          echo "Invalid parameter. Please check your input parameters."
          TENANT_PASSWORD=$TEMP_TENANT_PASSWORD
      else
          # Generic error handling
          echo "Failed to retrieve secret value for: $TENANT_USER"
          TENANT_PASSWORD=$TEMP_TENANT_PASSWORD
      fi
  fi
  echo 'TENANT_PASSWORD='$TENANT_PASSWORD
  TENANT_TOKEN=$(aws cognito-idp admin-initiate-auth \
    --user-pool-id $TENANT_USERPOOL_ID \
    --auth-flow ADMIN_USER_PASSWORD_AUTH \
    --client-id $TENANT_USERPOOL_CLIENT_ID \
    --auth-parameters USERNAME=$TENANT_USER,PASSWORD=$TENANT_PASSWORD \
    --query 'AuthenticationResult.IdToken' \
    --output text)
  echo "Login with user TENANT_TOKEN: $TENANT_TOKEN"
  ITERATOR=1
  # Create product review
  for i in $(seq 1 $ITERATOR); do
    echo "Adding review $i"
    # bash code to get random number between 1 and 5 and to randaomize the review description
    review_suffix_id=$((1 + RANDOM % 5))
    REVIEW_DESCRIPTION_ID=$(eval echo 'REVIEW_DESCRIPTION'$review_suffix_id)
    review_description=${!REVIEW_DESCRIPTION_ID}
    response=$(curl --request POST \
      --url "${SERVERLESS_SAAS_API_GATEWAY_URL}productreview" \
      --header "Authorization: Bearer ${TENANT_TOKEN}" \
      --header 'x-service-identifier: ProductReviewService' \
      --header 'content-type: application/json' \
      --data "{\"product_id\":$i,\"order_id\":$i,\"rating\":5,\"review_description\":\"$review_description >>> For product ID - $i\"}")
    
    echo "response: $response"   
  done
  # List reviews
  response=$(curl --request GET \
    --url "${SERVERLESS_SAAS_API_GATEWAY_URL}productreview" \
    --header "Authorization: Bearer ${TENANT_TOKEN}" \
    --header 'x-service-identifier: ProductReviewService' \
    --header 'content-type: application/json' \
    ) 
done