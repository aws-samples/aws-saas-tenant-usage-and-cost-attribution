#!/bin/bash -e

STACK_NAME_SERVERLESS=ServerlessSaaSAppStack
STACK_NAME_SHAREDINFRA=SharedServicesStack
echo "Testing Usage Aggregator Service"

COARSE_GRAINED_AGGREGATOR=$(aws cloudformation describe-stacks --stack-name $STACK_NAME_SHAREDINFRA --query "Stacks[0].Outputs[?ExportName=='CoarseGrainedUsageAggregatorLambda'].OutputValue" --output text)
TENANT_USAGE_BUCKET=$(aws cloudformation describe-stacks --stack-name $STACK_NAME_SHAREDINFRA --query "Stacks[0].Outputs[?ExportName=='TenantUsageBucketName'].OutputValue" --output text)
echo "Coarse Grained Aggregator: $COARSE_GRAINED_AGGREGATOR"
echo "Tenant Usage Bucket: $TENANT_USAGE_BUCKET"

aws lambda invoke --function-name $COARSE_GRAINED_AGGREGATOR out.json

echo "Checking if the results were saved in S3"
aws s3 ls s3://$TENANT_USAGE_BUCKET/coarse_grained/