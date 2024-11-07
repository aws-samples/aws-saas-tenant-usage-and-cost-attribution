#!/bin/bash
# Specify the profile name (use "default" if you want the default profile)
profile_name="default"

# Get the AWS region from the specified profile
aws_region=$(aws configure get region --profile "$profile_name")

if [ -n "$aws_region" ]; then
    echo "AWS Region for profile '$profile_name': $aws_region"
else
    echo "AWS Region is not set for profile '$profile_name' in the AWS CLI configuration."
fi
# Set your AWS region
echo "AWS_REGION: ${aws_region}"
export AWS_REGION=$aws_region
# Set your Athena database and output location
DATABASE="tenant_daily_usage"
STACK_NAME_SHAREDINFRA="SharedServicesStack"
ATHENA_OUTPUT_BUCKET_NAME=$(aws cloudformation describe-stacks --stack-name $STACK_NAME_SHAREDINFRA --query "Stacks[0].Outputs[?ExportName=='AthenaOutputBucketName'].OutputValue" | jq -r '.[0]')
TENANT_USAGE_BUCKET=$(aws cloudformation describe-stacks --stack-name $STACK_NAME_SHAREDINFRA --query "Stacks[0].Outputs[?ExportName=='TenantUsageBucketName'].OutputValue" --output text)

OUTPUT_LOCATION="s3://$ATHENA_OUTPUT_BUCKET_NAME/athena-query-results/"
COARSE_GRAINED_LOCATION="s3://$TENANT_USAGE_BUCKET/coarse_grained/"
FINE_GRAINED_LOCATION="s3://$TENANT_USAGE_BUCKET/fine_grained/"

# for loop the below section with decrement date_offset parameter
for date_offset in {-1..-3}; do
    # Escape single quotes in the query
    echo "COARSE GRAINED Usage Data creation STARTED for date offset $date_offset"
    # COARSE GRAINED USAGE METRICS
    COARSE_GRAINED_QUERY="UNLOAD (
        SELECT 
            tenant_id, 
            DATE_FORMAT(DATE_ADD('day', $date_offset, CAST(date AS timestamp)), '%Y-%m-%d 00:00:00.000') AS date, 
            usage_unit, 
            tenant_usage, 
            total_usage, 
            tenant_percent_usage,
            EXTRACT(YEAR FROM DATE_ADD('day', $date_offset, CAST(date AS timestamp))) AS year,
            EXTRACT(MONTH FROM DATE_ADD('day', $date_offset, CAST(date AS timestamp))) AS month
        FROM 
            \"tenant_daily_usage\".\"tenant_usage_coarse_grained\"
        WHERE 
            CAST(date AS timestamp) = CAST(DATE_FORMAT(CURRENT_DATE, '%Y-%m-%d 00:00:00.000') AS timestamp)
        ORDER BY 
            date DESC
    )
    TO '$COARSE_GRAINED_LOCATION'
    WITH (
        format = 'JSON',
        compression = 'NONE',
        partitioned_by = ARRAY['year', 'month']
    )"

    # Execute the query
    COARSE_GRAINED_QUERY_EXECUTION_ID=$(aws athena start-query-execution \
        --query-string "$COARSE_GRAINED_QUERY" \
        --query-execution-context Database=$DATABASE \
        --result-configuration OutputLocation=$OUTPUT_LOCATION \
        --region $AWS_REGION \
        --output text \
        --work-group "saas-cost-attribution")

    echo "Query execution ID: $COARSE_GRAINED_QUERY_EXECUTION_ID"

    # Wait for the query to complete
    while true; do
        STATUS=$(aws athena get-query-execution --query-execution-id $COARSE_GRAINED_QUERY_EXECUTION_ID --region $AWS_REGION --output text --query 'QueryExecution.Status.State')
        if [ $STATUS == "SUCCEEDED" ]; then
            echo "Query succeeded"
            break
        elif [ $STATUS == "FAILED" ] || [ $STATUS == "CANCELLED" ]; then
            echo "Query $STATUS"
            exit 1
        else
            echo "Query is $STATUS. Waiting..."
            sleep 5
        fi
    done
    echo "COARSE GRAINED Usage Data creation complete for date offset $date_offset"

    echo "FINE GRAINED Usage Data creation STARTED for date offset $date_offset"

    # FINE GRAINED USAGE METRICS
    FINE_GRAINED_QUERY="UNLOAD (
        SELECT 
            tenant_id, 
            DATE_FORMAT(DATE_ADD('day', $date_offset, CAST(date AS timestamp)), '%Y-%m-%d 00:00:00.000') AS date, 
            usage_unit, 
            service_name, 
            tenant_usage, 
            total_usage, 
            tenant_percent_usage,
            EXTRACT(YEAR FROM DATE_ADD('day', $date_offset, CAST(date AS timestamp))) AS year,
            EXTRACT(MONTH FROM DATE_ADD('day', $date_offset, CAST(date AS timestamp))) AS month
        FROM 
            \"tenant_daily_usage\".\"tenant_usage_fine_grained\"
        WHERE 
            CAST(date AS timestamp) = CAST(DATE_FORMAT(CURRENT_DATE, '%Y-%m-%d 00:00:00.000') AS timestamp)
        ORDER BY 
            date DESC
    )
    TO '$FINE_GRAINED_LOCATION'
    WITH (
        format = 'JSON',
        compression = 'NONE',
        partitioned_by = ARRAY['year', 'month']
    )"

    # Execute the query
    FINE_GRAINED_QUERY_EXECUTION_ID=$(aws athena start-query-execution \
        --query-string "$FINE_GRAINED_QUERY" \
        --query-execution-context Database=$DATABASE \
        --result-configuration OutputLocation=$OUTPUT_LOCATION \
        --region $AWS_REGION \
        --output text \
        --work-group "saas-cost-attribution")

    echo "Query execution ID: $FINE_GRAINED_QUERY_EXECUTION_ID"

    # Wait for the query to complete
    while true; do
        STATUS=$(aws athena get-query-execution --query-execution-id $FINE_GRAINED_QUERY_EXECUTION_ID --region $AWS_REGION --output text --query 'QueryExecution.Status.State')
        if [ $STATUS == "SUCCEEDED" ]; then
            echo "Query succeeded"
            break
        elif [ $STATUS == "FAILED" ] || [ $STATUS == "CANCELLED" ]; then
            echo "Query $STATUS"
            exit 1
        else
            echo "Query is $STATUS. Waiting..."
            sleep 5
        fi
    done
    echo "FINE GRAINED Usage Data creation complete for date offset $date_offset"
done
# end for loop
echo "Usage Data creation complete!"
# run the AWS Glue Crawler and check for completion
# Get the crawler name
CRAWLER_NAME=$(aws cloudformation describe-stack-resources \
    --stack-name $STACK_NAME_SHAREDINFRA \
    --query "StackResources[?ResourceType=='AWS::Glue::Crawler'].PhysicalResourceId" \
    --output text)
echo "Crawler Name: $CRAWLER_NAME"
aws glue start-crawler --name $CRAWLER_NAME --region $AWS_REGION
while true; do
    STATUS=$(aws glue get-crawler --name $CRAWLER_NAME --region $AWS_REGION --output text --query 'Crawler.State')
    if [ $STATUS == "READY" ]; then
        echo "Crawler $CRAWLER_NAME is ready"
        break
    else
        echo "Crawler $CRAWLER_NAME is $STATUS. Waiting..."
        sleep 10
    fi
done