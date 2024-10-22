#!/bin/bash -e

SHARED_SERVICES_STACK_NAME='SharedServicesStack'
export REGION=$(aws configure get region)
echo "REGION: ${REGION}"
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "ACCOUNT_ID: ${ACCOUNT_ID}"

cd ../cdk
echo ${PWD}

npm install
npm run build

# Executing the ApplicationPlaneStack CDK stack to create ECS Cluster, ALB, S3 Bucket, ECR, Parameter Store, APIGW Resource
cdk deploy --all --require-approval never --concurrency 10 --asset-parallelism true

TENANT_USAGE_BUCKET=$(aws cloudformation describe-stacks --stack-name $SHARED_SERVICES_STACK_NAME --query "Stacks[0].Outputs[?ExportName=='TenantUsageBucketName'].OutputValue" --output text)
# Create a prefix in TENANT_USAGE_BUCKET
aws s3api put-object --bucket $TENANT_USAGE_BUCKET --key s3_storage_lens_report/ 


# Building the code and preparing Product Media Docker Image
cd ../src
docker build --platform linux/amd64 -f resources/dockerfile -t product-media-service:latest .

# Login to ECR
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com

# Tag the image and push it to product-media-service ECR repo
docker tag product-media-service:latest $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/product-media-service:latest
docker push $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/product-media-service:latest

API_ID=$(
  aws cloudformation describe-stacks \
    --stack-name $SHARED_SERVICES_STACK_NAME \
    --query "Stacks[0].Outputs[?contains(OutputKey,'AppPlaneApiGatewayId')].OutputValue" \
    --output text
)
echo "API_ID: $API_ID"

# Re-Deploy API in Prod stage
aws apigateway create-deployment \
  --rest-api-id "$API_ID" \
  --stage-name prod \
  --description "Product Service services deployment."
