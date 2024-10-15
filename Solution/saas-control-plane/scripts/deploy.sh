#!/bin/bash -e

export CDK_PARAM_SYSTEM_ADMIN_EMAIL="$1"

if [[ -z "$CDK_PARAM_SYSTEM_ADMIN_EMAIL" ]]; then
  echo "Please provide system admin email"
  exit 1
fi


REGION=$(aws configure get region)

# Preprovision base infrastructure
cd ../cdk
npm install

npx cdk bootstrap
npx cdk deploy --all --require-approval never --concurrency 10 --asset-parallelism true
