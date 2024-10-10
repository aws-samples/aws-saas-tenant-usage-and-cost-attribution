#!/bin/bash -e

STACK_NAME_SERVERLESS=ServerlessSaaSAppStack
STACK_NAME_SHAREDINFRA=SharedServicesStack
echo "Testing Usage Aggregator Service"

FINE_GRAINED_AGGREGATOR=$(aws cloudformation describe-stacks --stack-name $STACK_NAME_SERVERLESS --query "Stacks[0].Outputs[?ExportName=='FineGrainedUsageAggregatorLambda'].OutputValue" --output text)
TENANT_USAGE_BUCKET=$(aws cloudformation describe-stacks --stack-name $STACK_NAME_SHAREDINFRA --query "Stacks[0].Outputs[?ExportName=='TenantUsageBucketName'].OutputValue" --output text)
echo "Fine Grained Aggregator: $FINE_GRAINED_AGGREGATOR"
echo "Tenant Usage Bucket: $TENANT_USAGE_BUCKET"

aws lambda invoke --function-name $FINE_GRAINED_AGGREGATOR out.json

echo "Checking if the results were saved in S3"
aws s3 ls s3://$TENANT_USAGE_BUCKET/fine_grained/