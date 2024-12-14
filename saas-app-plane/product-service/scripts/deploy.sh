#!/bin/bash -e

cp ../../../Solution/saas-app-plane/product-service/src/dal/product_service_dal.py ../src/dal
cp ../../../Solution/saas-app-plane/product-service/src/product_service.py ../src
cp ../../../Solution/saas-app-plane/product-service/src/extensions/telemetry-api/telemetry_api_extension/telemetry_service.py ../src/extensions/telemetry-api/telemetry_api_extension
cp ../../../Solution/saas-app-plane/product-service/src/fine_grained_aggregator.py ../src

pip install pylint

SHARED_SERVICES_STACK_NAME='SharedServicesStack'

cd ../src
#python3 -m pylint -E -d E0401 $(find . -iname "*.py" -not -path "./.aws-sam/*" -not -path "./extensions/*")

# Build extension.
cd extensions/telemetry-api
chmod +x telemetry_api_extension/extension.py
pip3 install -r telemetry_api_extension/requirements.txt -t ./telemetry_api_extension/

chmod +x extensions/telemetry_api_extension
# Check if we're on Windows
if [[ "$OSTYPE" == "msys"* || "$OSTYPE" == "cygwin"* ]]; then
    echo "Running on Windows, using 7-Zip"
    7z a -tzip extension.zip extensions telemetry_api_extension
else
    zip -r extension.zip extensions telemetry_api_extension
fi


cd ../../../cdk
npm install
npm run build

cdk deploy --all --require-approval never --concurrency 10 --asset-parallelism true

# Deploy API services to stage.
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
  --description "Product services deployment."
