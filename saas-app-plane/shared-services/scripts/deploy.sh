#!/bin/bash -e

python3 -m pip install pylint

cd ../src
#python3 -m pylint -E -d E0401 $(find . -iname "*.py" -not -path "./.aws-sam/*")

cd ../cdk
npm install
npm run build

cdk bootstrap
cdk deploy --all --require-approval never --concurrency 10 --asset-parallelism true

