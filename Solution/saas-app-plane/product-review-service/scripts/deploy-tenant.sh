#!/bin/bash -e

if [ -z "$1" ]; then
  echo "Usage: $0 <tenantId>"
  exit 1
fi

echo "AWS_REGION: ${AWS_REGION}"
export REGION=$AWS_REGION
echo "REGION: ${REGION}"
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "ACCOUNT_ID: ${ACCOUNT_ID}"

TENANT_ID=$1
echo "Provision tenant: ${TENANT_ID}"

cd ../cdk
npm install
echo ${PWD}
    
npx cdk deploy "ProductReviewTenantProvisioningStack-$TENANT_ID" --app "npx ts-node bin/product-review-app.ts" \
    --context tenantId=$TENANT_ID \
    --require-approval never