#!/bin/bash -e

if [ -z "$1" ]; then
  echo "Usage: $0 <tenantId>"
  exit 1
fi
echo "AWS_REGION: ${AWS_REGION}"
export REGION=$AWS_REGION
echo "REGION: ${REGION}"
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "Account ID: ${ACCOUNT_ID}"

TENANT_ID=$1
export TENANT_ID
echo "Provision tenant: ${TENANT_ID}"
MEDIA_SERVICES_STACK_NAME='ProductMediaAppStack'
APPLICATION_PLANE_LISTENER_ARN=$(aws cloudformation describe-stacks --stack-name $MEDIA_SERVICES_STACK_NAME --query "Stacks[0].Outputs[?OutputKey=='ApplicationPlaneListenerArn'].OutputValue" --output text)
HIGHEST_PRIORITY_BASE=$(aws elbv2 describe-rules --listener-arn $APPLICATION_PLANE_LISTENER_ARN --query 'Rules[*].Priority' --output text | tr '\t' '\n' | grep -v default | sort -rn | head -1)
echo "HIGHEST_PRIORITY_BASE is from listener: $HIGHEST_PRIORITY_BASE"
# Check if HIGHEST_PRIORITY_BASE is empty or not a number
if [ -z "$HIGHEST_PRIORITY_BASE" ] || ! [[ "$HIGHEST_PRIORITY_BASE" =~ ^[0-9]+$ ]]; then
    HIGHEST_PRIORITY_BASE=10
    echo "PRIORITY_BASE was empty or not a number. Setting it to default value: $HIGHEST_PRIORITY_BASE"
fi
echo "HIGHEST_PRIORITY_BASE is now: $HIGHEST_PRIORITY_BASE"
export PRIORITY_BASE=$(($HIGHEST_PRIORITY_BASE + 10))
echo "Deploying stack for $TENANT_ID with listener rule priority base $PRIORITY_BASE"

cd ../cdk
npm install
# Executing the ApplicationPlaneStack CDK stack to create ECS Cluster, ALB, S3 Bucket, ECR, Parameter Store, APIGW Resource
npx cdk deploy "ProductMediaTenantStack-${TENANT_ID}" --require-approval never --concurrency 10 --asset-parallelism true

cd ../scripts
echo $PRIORITY_BASE