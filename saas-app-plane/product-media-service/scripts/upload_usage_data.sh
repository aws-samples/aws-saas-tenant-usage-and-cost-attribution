#!/bin/bash -e

STACK_NAME_SERVERLESS=ServerlessSaaSAppStack
STACK_NAME_SHAREDINFRA=SharedServicesStack
echo "Uploading sample s3 storage lens data to the Tenant Usage Bucket"

TENANT_USAGE_BUCKET=$(aws cloudformation describe-stacks --stack-name $STACK_NAME_SHAREDINFRA --query "Stacks[0].Outputs[?ExportName=='TenantUsageBucketName'].OutputValue" --output text)
echo "Tenant Usage Bucket: $TENANT_USAGE_BUCKET"
aws s3 cp ../data/s3_storage_lens_report/  s3://$TENANT_USAGE_BUCKET/s3_storage_lens_report/  --recursive
# run the AWS Glue Crawler and check for completion
# Get the crawler name
CRAWLER_NAME=$(aws cloudformation describe-stack-resources \
    --stack-name $STACK_NAME_SHAREDINFRA \
    --query "StackResources[?ResourceType=='AWS::Glue::Crawler'].PhysicalResourceId" \
    --output text)

if [ -n "$CRAWLER_NAME" ]; then
    echo "Glue Crawler name: $CRAWLER_NAME"
else
    echo "No AWS::Glue::Crawler resource found in the stack $STACK_NAME"
fi
aws glue start-crawler --name $CRAWLER_NAME
echo "Waiting for the crawler to complete..."
while true; 
do
    STATUS=$(aws glue get-crawler --name $CRAWLER_NAME --output text --query 'Crawler.State')
    if [ $STATUS == "READY" ]; then
        echo "Crawler $CRAWLER_NAME is ready"
        break
    else
        echo "Crawler $CRAWLER_NAME is $STATUS. Waiting..."
        sleep 10
    fi
done
echo "Crawler $CRAWLER_NAME is ready"
DATABASE_NAME="tenant_daily_usage"
TABLE_NAME="tenant_usage_s3_storage_lens_report"
# Get the current table definition
TABLE_INPUT=$(aws glue get-table \
    --database-name $DATABASE_NAME \
    --name $TABLE_NAME \
    --query 'Table' \
    --output json)
# Update the SerDe library and parameters
UPDATED_TABLE_INPUT=$(echo $TABLE_INPUT | jq '
    .StorageDescriptor.SerdeInfo = {
        "SerializationLibrary": "org.apache.hadoop.hive.serde2.OpenCSVSerde",
        "Parameters": {
            "separatorChar": ",",
            "quoteChar": "\"",
            "escapeChar": "\\"
        }
    } |
    del(.DatabaseName) |
    del(.CreateTime, .UpdateTime, .CreatedBy, .IsRegisteredWithLakeFormation, .CatalogId, .VersionId)
')
echo "Applying update..."
UPDATE_RESULT=$(aws glue update-table --database-name $DATABASE_NAME --table-input "$UPDATED_TABLE_INPUT" 2>&1)
echo "Update result:"
echo $UPDATE_RESULT

echo "Verifying update..."
UPDATED_TABLE=$(aws glue get-table --database-name $DATABASE_NAME --name $TABLE_NAME --query 'Table' --output json)
echo "Updated table definition:"

if [ "$CURRENT_TABLE" = "$UPDATED_TABLE" ]; then
    echo "Warning: Table definition did not change."
else
    echo "Table was successfully updated."
fi
echo "Table $TABLE_NAME in database $DATABASE_NAME has been updated."