#!/bin/bash -e
PRODUCT_REVIEW_APP_STACK=ProductReviewAppStack
STACK_NAME_SERVERLESS=ServerlessSaaSAppStack
STACK_NAME_SHAREDINFRA=SharedServicesStack
echo "Testing Usage Aggregator Service"

COARSE_GRAINED_AGGREGATOR=$(aws cloudformation describe-stacks --stack-name $STACK_NAME_SHAREDINFRA --query "Stacks[0].Outputs[?ExportName=='CoarseGrainedUsageAggregatorLambda'].OutputValue" --output text)
FINE_GRAINED_AGGREGATOR=$(aws cloudformation describe-stacks --stack-name $PRODUCT_REVIEW_APP_STACK --query "Stacks[0].Outputs[?ExportName=='ECSUsageAggregatorLambda'].OutputValue" --output text)
RDS_PERFORMANCE_INSIGHTS_DB_LOAD_AGGREGATOR=$(aws cloudformation describe-stacks --stack-name $PRODUCT_REVIEW_APP_STACK --query "Stacks[0].Outputs[?ExportName=='RDSPerformanceInsightsLambda'].OutputValue" --output text)
RDS_AURORA_IOPS_EXECUTION_TIME_AGGREGATOR=$(aws cloudformation describe-stacks --stack-name $PRODUCT_REVIEW_APP_STACK --query "Stacks[0].Outputs[?ExportName=='RDSIopsUsageLambda'].OutputValue" --output text)
RDS_AURORA_STORAGE_AGGREGATOR=$(aws cloudformation describe-stacks --stack-name $PRODUCT_REVIEW_APP_STACK --query "Stacks[0].Outputs[?ExportName=='RDSStorageUsageLambda'].OutputValue" --output text)

TENANT_USAGE_BUCKET=$(aws cloudformation describe-stacks --stack-name $STACK_NAME_SHAREDINFRA --query "Stacks[0].Outputs[?ExportName=='TenantUsageBucketName'].OutputValue" --output text)
echo "Coarse Grained Aggregator: $COARSE_GRAINED_AGGREGATOR"
echo "Fine Grained Aggregator: $FINE_GRAINED_AGGREGATOR"
echo "RDS_PERFORMANCE_INSIGHTS_DB_LOAD_AGGREGATOR: $RDS_PERFORMANCE_INSIGHTS_DB_LOAD_AGGREGATOR"
echo "RDS_AURORA_IOPS_EXECUTION_TIME_AGGREGATOR: $RDS_AURORA_IOPS_EXECUTION_TIME_AGGREGATOR"
echo "RDS_AURORA_STORAGE_AGGREGATOR: $RDS_AURORA_STORAGE_AGGREGATOR"
echo "Tenant Usage Bucket: $TENANT_USAGE_BUCKET"

aws lambda invoke --function-name $COARSE_GRAINED_AGGREGATOR out.json
aws lambda invoke --function-name $FINE_GRAINED_AGGREGATOR out.json
aws lambda invoke --function-name $RDS_PERFORMANCE_INSIGHTS_DB_LOAD_AGGREGATOR out.json
aws lambda invoke --function-name $RDS_AURORA_IOPS_EXECUTION_TIME_AGGREGATOR out.json
aws lambda invoke --function-name $RDS_AURORA_STORAGE_AGGREGATOR out.json


echo "Checking if the results were saved in S3"
aws s3 ls s3://$TENANT_USAGE_BUCKET/coarse_grained/
aws s3 ls s3://$TENANT_USAGE_BUCKET/fine_grained/