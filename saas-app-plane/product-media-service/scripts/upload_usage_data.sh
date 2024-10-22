#!/bin/bash -e

STACK_NAME_SERVERLESS=ServerlessSaaSAppStack
STACK_NAME_SHAREDINFRA=SharedServicesStack
echo "Uploading sample s3 storage lens data to the Tenant Usage Bucket"

TENANT_USAGE_BUCKET=$(aws cloudformation describe-stacks --stack-name $STACK_NAME_SHAREDINFRA --query "Stacks[0].Outputs[?ExportName=='TenantUsageBucketName'].OutputValue" --output text)
echo "Tenant Usage Bucket: $TENANT_USAGE_BUCKET"
aws s3 cp ../data/s3_storage_lens_report/  s3://$TENANT_USAGE_BUCKET/s3_storage_lens_report/  --recursive