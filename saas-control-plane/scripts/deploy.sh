#!/bin/bash -e

export CDK_PARAM_SYSTEM_ADMIN_EMAIL="$1"

if [[ -z "$CDK_PARAM_SYSTEM_ADMIN_EMAIL" ]]; then
  echo "Please provide system admin email"
  exit 1
fi

export AWS_REGION=$(aws configure get region)
if [ -z "$AWS_REGION" ]; then
  export TOKEN=$(curl -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds:60")
  export AWS_REGION=$(curl -H "X-aws-ec2-metadata-token:${TOKEN}" -s http://169.254.169.254/latest/meta-data/placement/availability-zone | sed 's/\(.*\)[a-z]/\1/')
fi
echo "REGION: ${AWS_REGION}"

# Preprovision base infrastructure
cd ../cdk
npm install

npx cdk bootstrap
npx cdk deploy --all --require-approval never --concurrency 10 --asset-parallelism true
