#!/bin/bash -e

[[ -z "$1" ]] && {
  cp ../../../Solution/saas-app-plane/product-review-service/src/lambdas-aggregator/ecs-usage-aggregator.py ../src/lambdas-aggregator
}

SHARED_SERVICES_STACK_NAME='SharedServicesStack'

export AWS_REGION=$(aws configure get region)
if [ -z "$AWS_REGION" ]; then
  export TOKEN=$(curl -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds:60")
  export AWS_REGION=$(curl -H "X-aws-ec2-metadata-token:${TOKEN}" -s http://169.254.169.254/latest/meta-data/placement/availability-zone | sed 's/\(.*\)[a-z]/\1/')
fi
echo "REGION: ${AWS_REGION}"
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "ACCOUNT_ID: ${ACCOUNT_ID}"


cd ../cdk
echo ${PWD}

npm install
npm run build

npx cdk deploy "ProductReviewAppStack" --app "npx ts-node bin/product-review-app.ts" --require-approval never 

IMAGE_VERSION=$(date +%s)
echo "IMAGE_VERSION: ${IMAGE_VERSION}"

cd ../src

docker build --platform linux/amd64 -f resources/Dockerfile -t product-review-service:$IMAGE_VERSION .

# Login to ECR 
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com

# Tag the image and push it to product-service ECR repo
docker tag product-review-service:$IMAGE_VERSION $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/product-review-service:$IMAGE_VERSION

docker push $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/product-review-service:$IMAGE_VERSION


cd ../cdk

npx cdk deploy "ProductReviewECSServiceStack" --app "npx ts-node bin/product-review-app.ts" \
    --context imageVersion=$IMAGE_VERSION \
    --require-approval never 

cd ../scripts

API_ID=$(
  aws cloudformation describe-stacks \
    --stack-name $SHARED_SERVICES_STACK_NAME \
    --query "Stacks[0].Outputs[?contains(OutputKey,'AppPlaneApiGatewayId')].OutputValue" \
    --output text
)
echo "API_ID: $API_ID"

# Deploy API for good measure.
aws apigateway create-deployment \
  --rest-api-id "$API_ID" \
  --stage-name prod \
  --description "Product review services deployment."
