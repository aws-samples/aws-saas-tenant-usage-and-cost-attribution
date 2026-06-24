#!/bin/bash -e

# Enable nocasematch option
shopt -s nocasematch

# Parse tenant details from the input message from step function
export CDK_PARAM_TENANT_ID=$(echo $tenantId | tr -d '"')
export TENANT_ADMIN_EMAIL=$(echo $email | tr -d '"')
export FEATURES=$(echo $features | tr -d '"')
export TIER=$(echo $tenantTier | tr -d '"')

# TENANT USER MANAGEMENT SERVICE : Provision a new tenant admin user
# Define variables
SHARED_SERVICES_STACK_NAME="SharedServicesStack"
TENANT_ADMIN_USERNAME="tenant-admin-$CDK_PARAM_TENANT_ID"
USER_POOL_OUTPUT_PARAM_NAME="TenantUserpoolId"
API_GATEWAY_URL_OUTPUT_PARAM_NAME="AppPlaneApiGatewayUrl"
APP_CLIENT_ID_OUTPUT_PARAM_NAME="TenantUserPoolClientId"


# Read tenant details from the cloudformation stack output parameters
SAAS_APP_USERPOOL_ID=$(aws cloudformation describe-stacks --stack-name $SHARED_SERVICES_STACK_NAME --query "Stacks[0].Outputs[?OutputKey=='$USER_POOL_OUTPUT_PARAM_NAME'].OutputValue" --output text)
SAAS_APP_CLIENT_ID=$(aws cloudformation describe-stacks --stack-name $SHARED_SERVICES_STACK_NAME --query "Stacks[0].Outputs[?OutputKey=='$APP_CLIENT_ID_OUTPUT_PARAM_NAME'].OutputValue" --output text)
API_GATEWAY_URL=$(aws cloudformation describe-stacks --stack-name $SHARED_SERVICES_STACK_NAME --query "Stacks[0].Outputs[?OutputKey=='$API_GATEWAY_URL_OUTPUT_PARAM_NAME'].OutputValue" --output text)

# Code to generate a random password with Alpha Numeric and one symbol character
PASSWORD=$(openssl rand -base64 8 | sed 's/[\/+=]/#/g')
# add small & capital letter, digit and symbol to ensure to meet password policy
PASSWORD=$PASSWORD'aB#9'
echo "Generated Password: $PASSWORD"

# set this password as a secret in secrets manager
aws secretsmanager create-secret \
  --name "$TENANT_ADMIN_USERNAME" \
  --secret-string "$PASSWORD" \
  --region "$AWS_REGION"

# Create tenant admin user
aws cognito-idp admin-create-user \
  --user-pool-id "$SAAS_APP_USERPOOL_ID" \
  --username "$TENANT_ADMIN_USERNAME" \
  --user-attributes Name=email,Value="$TENANT_ADMIN_EMAIL" Name=email_verified,Value="True" Name=phone_number,Value="+11234567890" Name="custom:userRole",Value="TenantAdmin" Name="custom:tenantId",Value="$CDK_PARAM_TENANT_ID" Name="custom:tenantTier",Value="$TIER" Name="custom:features",Value="$FEATURES"\
  --desired-delivery-mediums EMAIL

# Create tenant user group
aws cognito-idp create-group \
  --user-pool-id "$SAAS_APP_USERPOOL_ID" \
  --group-name "$CDK_PARAM_TENANT_ID"

# Add tenant admin user to tenant user group
aws cognito-idp admin-add-user-to-group \
  --user-pool-id "$SAAS_APP_USERPOOL_ID" \
  --username "$TENANT_ADMIN_USERNAME" \
  --group-name "$CDK_PARAM_TENANT_ID"

echo "Set user password"
aws cognito-idp admin-set-user-password \
  --user-pool-id $SAAS_APP_USERPOOL_ID \
  --username $TENANT_ADMIN_USERNAME \
  --password $PASSWORD \
  --permanent

# Create JSON response of output parameters
export tenantConfig=$(jq --arg SAAS_APP_USERPOOL_ID "$SAAS_APP_USERPOOL_ID" \
  --arg SAAS_APP_CLIENT_ID "$SAAS_APP_CLIENT_ID" \
  --arg API_GATEWAY_URL "$API_GATEWAY_URL" \
  -n '{"userPoolId":$SAAS_APP_USERPOOL_ID,"appClientId":$SAAS_APP_CLIENT_ID,"apiGatewayUrl":$API_GATEWAY_URL}')
export tenantStatus="Complete"

echo "FEATURES: $FEATURES"
echo "CDK_PARAM_TENANT_ID: $CDK_PARAM_TENANT_ID"
# clone the github code 
echo "clone start saas-app-plane from github"
git clone https://github.com/aws-samples/aws-saas-tenant-usage-and-cost-attribution.git
ls -ltr
cd aws-saas-tenant-usage-and-cost-attribution
echo "clone complete saas-app-plane from github"
echo $PWD
ls -ltr
# if $FEATURES=MediaService then do set of commands
if [[ "$FEATURES" == *"MediaService"* ]]; then
    echo "Deploying Media Service"
    cd ./saas-app-plane/product-media-service/scripts
    ls -ltr
    ./deploy-tenant.sh $CDK_PARAM_TENANT_ID
    cd ../../../
fi
# if $FEATURES=ReviewService then do set of commands
if [[ "$FEATURES" == *"ReviewService"* ]]; then
    echo "Deploying Review Service"
    cd ./saas-app-plane/product-review-service/scripts
    ls -ltr
    ./deploy-tenant.sh $CDK_PARAM_TENANT_ID
    cd ../../../
fi