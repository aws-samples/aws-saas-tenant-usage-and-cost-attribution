#!/bin/bash -e

STACK_NAME_SERVERLESS=ServerlessSaaSAppStack
STACK_NAME_SHAREDINFRA=SharedServicesStack
echo "Uploading sample ECS split cost allocation data and s3 storage lens data to Tenant Usage Bucket"

TENANT_USAGE_BUCKET=$(aws cloudformation describe-stacks --stack-name $STACK_NAME_SHAREDINFRA --query "Stacks[0].Outputs[?ExportName=='TenantUsageBucketName'].OutputValue" --output text)
echo "Tenant Usage Bucket: $TENANT_USAGE_BUCKET"
aws s3 cp ../data  s3://$TENANT_USAGE_BUCKET/ --recursive