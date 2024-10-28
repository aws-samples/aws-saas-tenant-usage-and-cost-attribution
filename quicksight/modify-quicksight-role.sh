#!/bin/bash -e

export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "ACCOUNT_ID: ${ACCOUNT_ID}"
export ROLE_NAME=CidQuickSightDataSourceRole
echo "ROLE_NAME: ${ROLE_NAME}"
export POLICY_NAME=TenantUsageAccess

SHARED_SERVICES_STACK_NAME='SharedServicesStack'
TENANT_USAGE_BUCKET=$(aws cloudformation describe-stacks --stack-name $SHARED_SERVICES_STACK_NAME --query "Stacks[0].Outputs[?ExportName=='TenantUsageBucketName'].OutputValue" --output text)
echo "TENANT_USAGE_BUCKET: ${TENANT_USAGE_BUCKET}"

inlinePolicy=$(cat <<-EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Action": [
                "glue:GetPartition",
                "glue:GetPartitions",
                "glue:GetDatabase",
                "glue:GetDatabases",
                "glue:GetTable",
                "glue:GetTables"
            ],
            "Resource": [
                "arn:aws:glue:us-east-1:${ACCOUNT_ID}:database/tenant_daily_usage",
                "arn:aws:glue:us-east-1:${ACCOUNT_ID}:table/tenant_daily_usage/*"
            ],
            "Effect": "Allow",
            "Sid": "AllowGlueTenantUsage"
        },
        {
            "Action": "s3:ListBucket",
            "Resource": [
                "arn:aws:s3:::${TENANT_USAGE_BUCKET}"
            ],
            "Effect": "Allow",
            "Sid": "AllowListBucket"
        },
        {
            "Action": [
                "s3:GetObject",
                "s3:GetObjectVersion"
            ],
            "Resource": [
                "arn:aws:s3:::${TENANT_USAGE_BUCKET}/*"
            ],
            "Effect": "Allow",
            "Sid": "AllowReadBucket"
        }
    ]
}
EOF
)

#add a policy to the role using aws cli
aws iam put-role-policy \
  --role-name $ROLE_NAME \
  --policy-name $POLICY_NAME \
  --policy-document "${inlinePolicy}"

    