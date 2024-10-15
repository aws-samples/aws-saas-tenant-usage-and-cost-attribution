#!/bin/bash
PWD
APP_PLANE_ARCHIVE_FILENAME="../../../saas-app-plane.zip"
ZIP_FILE_NAME="package/saas-app-plane.zip"

if [ -f "$APP_PLANE_ARCHIVE_FILENAME" ]; then
  rm "$APP_PLANE_ARCHIVE_FILENAME"
fi

cd ../../
PWD
zip -r ../saas-app-plane.zip . -x ".git/*" -x "**/node_modules/*" -x "**/cdk.out/*"

echo $ZIP_FILE_NAME

if [ $# -eq 1 ]; then
  if [ $1 == "upload" ]; then
    cd ./shared-services/scripts/
    PWD
    BUCKET_NAME=$(aws cloudformation describe-stacks --stack-name SharedServicesStack --query "Stacks[0].Outputs[?ExportName=='AthenaOutputBucketName'].OutputValue" | jq -r '.[0]')
    aws s3 cp $APP_PLANE_ARCHIVE_FILENAME s3://$BUCKET_NAME/$ZIP_FILE_NAME
  fi
fi