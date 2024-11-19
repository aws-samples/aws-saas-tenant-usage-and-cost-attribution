#!/bin/bash -e

pip install pylint

cd ../src

cd ../cdk
npm install
npm run build

cdk bootstrap
echo "CDK Bootstrap complete"
cdk deploy --all --require-approval never --concurrency 10 --asset-parallelism true
echo "CDK Deploy complete"