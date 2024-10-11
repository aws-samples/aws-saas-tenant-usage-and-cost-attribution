# Cost Visibility and Usage Attribution in Multi-Tenant SaaS Environments

Software-as-a-Service (SaaS) providers are constantly striving for cost and usage awareness across their users, tenants, features, and tiers. Understanding and optimizing the cost of running these various units inside your SaaS workload (users/tenants/features/tiers) is paramount for driving profitability and sustaining growth.

This workshop aims to equip you with the knowledge and tools necessary to calculate and visualize your unit cost within a SaaS environment. While the approaches we will discuss apply to any type of unit, the focus here will be on the “cost per tenant”, which is the most common concern we see for SaaS providers operating their SaaS solutions on AWS.

The corresponding workshop link for this repository will be available soon! Meanwhile, you can follow the below deployment instructions to deploy the code in this repository.

## Prerequisite
Deploy the pre-requisites to get started.

In order to run this workshop you will need access to a workstation with an IDE installed, such as Visual Studio Code. In addition, you will need:

1. Python 3.9 or above
2. [AWS CLI 2.14](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) or above installed.
3. [Docker Engine](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-docker.html) installed.
4. [AWS CDK](https://docs.aws.amazon.com/cdk/v2/guide/cli.html) 2.160 or above, which is used for writing the infrastructure-as-a-code of our microservices.
5. Node 18 or above
6. Git
7. jq

## Deploy the AWS SaaS Builder Toolkit (SBT) control plane 
```
cd saas-control-plane/scripts
./deploy.sh <email>
cd ../../

```

Wait for the stack to deploy. This will provision the SaaSControlPlaneStack, which creates the tenant management api, tenant management Amazon DynamoDB table, Amazon Cognito user pool for the tenant admin, Amazon EventBridge to publish the tenant created events.

## Deploy the App plane shared infrastructure stack

This stack provisions the 
1. Tenant provisioning infrastructure, which creates the Amazon EventBridge rule to listen to the tenant created event and a AWS Step functions which uses the code build to run the provision-tenant.sh as a response to the tenant created event.
2. Amazon Simple Storage Service (Amazon S3) bucket for tenant usage and glue tables
3. Shared Amazon Cognito user pool for authentication
4. A shared Amazon API Gateway API that all of our microservices will use, along with the AWS Lambda authorizer
5. "User management" apis for managing tenant users.

```
cd saas-app-plane/shared-services/scripts/
./deploy.sh 
```
### [Interim step] Packaging the saas-app-plane

As an interim step, package the saas-app-plane, upload to Amazon S3 so that it will be used in the provision-tenant.sh as part of AWS Code Build pipeline during tenant provisioning. This step is not required once the git project goes public, in that case we will do git clone.

```
./package-app-plane.sh upload
cd ../../../

```

## Deploy the serverless product and order microservice

Deploy the pooled serverless product and order microservices. The below command will deploy the AWS Lambda and Amazon DynamoDB tables required for product and order services.

```
cd saas-app-plane/product-service/scripts/
./deploy.sh
cd ../../../

```
## Tenant Onboarding for Product and Order Service

Typically the SaaS Administrator will onboard the tenants by providing the list of features or products for which the tenant have signed up. In our lab scenario we have 3 features namely

1. ProductService
2. MediaService 
3. ReviewService 

Run the below command to onboard a new tenant inside our SaaS application. As part of onboarding, a new tenant admin user is also created. You will receive an email with the credentials for the tenant admin user through the provided email.

We will now onboard 3 tenants for ProductService by running the below command.

Provide 3 valid inputs (email, name and the opted features from above features list).

Tip: In case if you don't have as many email Id's to create tenants, you can use the same email Id for all the tenants.

```
cd saas-app-plane/shared-services/scripts/
./onboard-tenant.sh <email 1> <tenant name 1> "ProductService"
```
```
./onboard-tenant.sh <email 2> <tenant name 2> "ProductService"
```
```
./onboard-tenant.sh <email 3> <tenant name 3> "ProductService"
cd ../../../
```

```
"Example:"
    ./onboard-tenant.sh user@example.com "Acme Corp" "ProductService"
```

On tenant creation, the SBT control plane sends a new tenant created message to the Amazon EventBridge. The TenantProvisioningStack listens to the message and initiates the provisioning state machine. As also mentioned before, the state machine uses `saas-app-plane/provision-tenant.sh` to provision any tenant specific resources.

Make sure that the provisioning orchestrator state machine completes after running the above commands. You can check it in AWS Console `Code Build >  Build > Build projects >' and click on the Build project that starts with `SaaSTenantProvisionCoreAppl-` and watch out for the build history to see the completion.

## Test the serverless Product and Order services

Run the below command to test the product and order services. As the script runs, the coarse and fine grained usage metrics will be captured.

```
cd saas-app-plane/product-service/scripts/
./test_harness.sh
cd ../../../

```

## Product and Order service usage aggregator

We will now aggregate the usage metrics by running the below command which invokes set of AWS Lambda functions to aggregate the usage.

```
cd saas-app-plane/product-service/scripts/
./test-aggregator.sh
cd ../../../
```
## Querying the coarse and fine grained metrics

Lets now query our tenant usage using the Amazon Athena. 

1. Navigate to the AWS Glue console and from the left navigation click on "Data Catalog -> Crawlers". You will see a crawler that starts with "TenantUsageBucket". This crawler was created as part of the shared services setup. It is responsible for crawling the tenant usage Amazon S3 bucket and create Amazon Athena table to query the data inside these buckets.

2. Select this crawler and press the `Run` button. Wait for the crawler to finish.

3. Now navigate to the Amazon Athena console and change the database to `tenant_daily_usage` from the `Database` drop down in the left. You will notice two tables; `tenant_usage_coarse_grained` and `tenant_usage_fine_grained`.

4. Important: In the `Amazon Athena Console > Query Editor` change the Workgroup (on the right top) to `saas-cost-attribution`. This workgroup will have preconfigured settings for you.

5. You can now view the tenant coarse grained and fine grained usages by running below queries inside the query editor.

```
SELECT * FROM "tenant_daily_usage"."tenant_usage_coarse_grained" limit 10;
```

```
SELECT * FROM "tenant_daily_usage"."tenant_usage_fine_grained" limit 10;
```

## Deploy the Product Media service

Let us now deploy the product media service. The product media service is a containerized application deployed on Amazon Elastic Container Services (ECS) and uses Amazon S3. The product media service will be deployed in a silo model (ECS Service per Tenant).

The below command will deploy the Product Media infrastructure components like Amazon ECS, Amazon S3, AWS Application Load Balancers (ALB), Subnets. The command will create and run the AWS CloudFormation stack `ProductMediaAppStack` through AWS CDK:

```
cd saas-app-plane/product-media-service/scripts/
./deploy.sh 
cd ../../../
```

## Tenant Onboarding for Product Media service

Let us now create 3 tenants for Product Media service. Run the below script by providing valid email, tenant name and feature ("MediaService") as input.

Tip: In case if you don't have as many email Id's to create tenants, you can use the same email Id for all the tenants.


```
cd saas-app-plane/shared-services/scripts/
./onboard-tenant.sh <email 5> <tenant name 5> "MediaService"
```
```
./onboard-tenant.sh <email 6> <tenant name 6> "MediaService"
```
```
./onboard-tenant.sh <email 7> <tenant name 7> "MediaService"
cd ../../../
```

Make sure that the provisioning orchestrator state machine completes after running the above commands. You can check it in AWS Console `Code Build >  Build > Build projects >` and click on the Build project that starts with `SaaSTenantProvisionCoreAppl-` and watch out for the build status.

The `provision-tenant.sh` invokes the AWS CDK deploy of the Product Media service which deploys the tenant specifc resources like the AWS ECS Services and Tasks, AWS ALB rules to route to tenant specific Amazon ECS Services using the AWS CloudFormation stack `ProductMediaTenantStack-<tenantId>`

## Test the Product Media service

We will use the product media service to upload media files to the S3 bucket with a prefix corresponding to the tenantId:

```
cd saas-app-plane/product-media-service/scripts/
./test_harness.sh

```

You should receive the following message upon a successful service call:

```
{
"message": "Product Media File test-image.png for product product1 and Tenant 24e13a77-3bb5-4568-b2dd-8f6b129dad00, is successfully uploaded to S3 Bucket product-media-1726074874200"
}
```

## Product Media Usage aggregator

Test the Product media usage aggregator, this is similar to the aggregator in the serverless but will just aggregate the coarse grained metrics. For the fine grained metrics, refer the next section

```
./test-aggregator.sh
```

## Amazon ECS Split cost allocation data and Amazon S3 Storage Lens report

## Fine-grained metrics

Both the Amazon ECS Split Cost Allocation Data and Amazon S3 Storage Lens report are typically daily reports that will be available on Amazon S3 buckets. Since they are NOT real time, the usage metrics data reflecting the test harness run will not be available immediately. To facilitate the lab flow, we have provided the sample data in `saas-app-plane/product-media-service/data` folder, we will now upload them to your S3 bucket using the below command.

```
./upload_usage_data.sh
cd ../../../

```

### Querying cost attribution

Lets now query our tenant cost attribution using the Amazon Athena. 

Navigate to the AWS Glue console and from the left navigation click on `Data Catalog -> Crawlers`. You will see a crawler that starts with `TenantUsageBucket`. Run the crawler, and navigate to the Athena console and select the database `tenant_daily_usage` from the `Database` drop down in the left. You will notice four tables; `tenant_usage_coarse_grained`,  `tenant_usage_fine_grained`, `tenant_usage_split_cost_allocation_data` and `tenant_usage_s3_storage_lens_report`

Click on `tenant_usage_split_cost_allocation_data` table, click Action -> Edit Table and change the Serialization lib to 

```
org.apache.hadoop.hive.serde2.OpenCSVSerde
```
This step is required to accomodate double quoted field values with comma (example: "Amazon Web Services, Inc") in the CUR report.

Important: In the Athena Console > Query Editor change the Workgroup (on the right top) to 'saas-cost-attribution'. This workgroup will have preconfigured settings for you.

You can now query the coarse grained and fine grained metrics from Amazon Athena.

### Coarse grained
```
SELECT * FROM "tenant_daily_usage"."tenant_usage_coarse_grained" limit 10;
```
### Amazon ECS fine grained

From the Amazon Athena Query editor, you can run the below query to get the ECS tenant cost attribution using the Amazon ECS Split Cost Allocation CUR Data

```
WITH ecs_split_cost_allocation_daily AS (
    SELECT 
        resource_tags_user_tenant_id, 
        line_item_usage_type, 
        CAST(DATE_PARSE(SUBSTR(identity_time_interval, 1, 10), '%Y-%m-%d') AS DATE) AS line_item_date, 
        split_line_item_split_cost, 
        split_line_item_unused_cost, 
        (split_line_item_split_cost + split_line_item_unused_cost) AS split_line_total_cost 
    FROM "tenant_daily_usage"."tenant_usage_split_cost_allocation_data" 
    WHERE resource_tags_user_tenant_id IS NOT NULL
),
tenant_metrics AS (
    SELECT 
        resource_tags_user_tenant_id AS tenant_id, 
        line_item_date AS report_date, 
        line_item_usage_type AS metric_group, 
        SUM(split_line_total_cost) AS metric_value
    FROM ecs_split_cost_allocation_daily 
    GROUP BY 
        line_item_date, 
        resource_tags_user_tenant_id, 
        line_item_usage_type
),
metric_group_totals AS (
    SELECT 
        report_date,
        metric_group,
        SUM(metric_value) AS group_total
    FROM tenant_metrics
    GROUP BY report_date, metric_group
)
SELECT 
    tm.tenant_id,
    tm.report_date,
    tm.metric_group,
    tm.metric_value,
    mgt.group_total,
    CASE 
        WHEN mgt.group_total = 0 THEN 0
        ELSE ROUND(CAST(tm.metric_value AS DOUBLE) / CAST(mgt.group_total AS DOUBLE) * 100, 2)
    END AS percentage_attribution
FROM tenant_metrics tm
JOIN metric_group_totals mgt 
    ON tm.report_date = mgt.report_date 
    AND tm.metric_group = mgt.metric_group
ORDER BY 
    tm.report_date, 
    tm.metric_group, 
    percentage_attribution DESC, 
    tm.tenant_id
```

You can view the S3 tenant cost attribution using the Amazon S3 Storage Lens data by running the below queries inside the query editor.

```
WITH grouped_metrics AS (
    SELECT 
        record_value AS tenant_id,
        report_date,
        CASE 
            WHEN metric_name = 'StorageBytes' THEN 'TimedStorage-ByteHrs'
            WHEN metric_name IN ('PutRequests', 'DeleteRequests', 'PostRequests', 'ListRequests') THEN 'Requests-Tier1'
            WHEN metric_name IN ('GetRequests', 'SelectRequests', 'HeadRequests') THEN 'Requests-Tier2'
            WHEN metric_name = 'BytesDownloaded' THEN 'Data Transfer Out-Bytes'
            ELSE 'Other'
        END AS metric_group,
        metric_value
    FROM "tenant_daily_usage"."tenant_usage_s3_storage_lens_report"
    WHERE record_type = 'PREFIX'
      AND metric_name IN ('StorageBytes', 'PostRequests', 'ListRequests', 
                          'SelectRequests', 'GetRequests', 'PutRequests', 
                          'DeleteRequests', 'HeadRequests', 'BytesDownloaded')
),
summed_metrics AS (
    SELECT 
        tenant_id,
        report_date,
        metric_group,
        SUM(metric_value) AS total_metric_value
    FROM grouped_metrics
    GROUP BY tenant_id, report_date, metric_group
),
metric_group_totals AS (
    SELECT 
        report_date,
        metric_group,
        SUM(total_metric_value) AS group_total
    FROM summed_metrics
    GROUP BY report_date, metric_group
)
SELECT 
    sm.tenant_id,
    sm.report_date,
    sm.metric_group,
    sm.total_metric_value,
    mgt.group_total,
    CASE 
        WHEN mgt.group_total = 0 THEN 0
        ELSE ROUND(CAST(sm.total_metric_value AS DOUBLE) / CAST(mgt.group_total AS DOUBLE) * 100, 2)
    END AS percentage_attribution
FROM summed_metrics sm
JOIN metric_group_totals mgt ON sm.report_date = mgt.report_date AND sm.metric_group = mgt.metric_group
ORDER BY sm.report_date, sm.metric_group, percentage_attribution DESC, sm.tenant_id
```
## Deploy Product Review Service

Let us deploy the the Product Review infrastructure components like Amazon ECS, Amazon RDS Aurora PostgreSQL, AWS Application Load Balancers (ALB), Subnets using the below command. The command below will create and run the AWS CloudFormation stack `ProductReviewAppStack` through AWS CDK:

Below command will provision the stack with
1. Pooled ECS service
2. Pooled Aurora RDS cluster and database
3. Usage Aggregator Lambda Functions

```
cd saas-app-plane/product-review-service/scripts/
./deploy.sh 
cd ../../../
```

## Tenant Onboarding for Product Review Service

Let us now create 3 test tenants for Product Review service. Run the below script by providing valid email, tenant name and feature (`ReviewService`) as input.

Tip: In case if you don't have as many email Id's to create tenants, you can use the same email Id for all the tenants.


```
cd saas-app-plane/shared-services/scripts/
./onboard-tenant.sh <email 8> <tenant name 5> "ReviewService"
```
```
./onboard-tenant.sh <email 9> <tenant name 6> "ReviewService"
```
```
./onboard-tenant.sh <email 10> <tenant name 7> "ReviewService"
cd ../../../
```

Make sure that the provisioning orchestrator state machine completes after running the above commands. You can check it in AWS Console `Code Build >  Build > Build projects >` and click on the Build project that starts with `SaaSTenantProvisionCoreAppl-` and watch out for the build status.

The `provision-tenant.sh` invokes the AWS CDK deploy of the Product Review service which deploys the tenant specifc resources like tenant database user and grant access to the pooled database/table using the AWS CloudFormation stack `ProductReviewTenantProvisioningStack-<tenantId>`.

## Test the Product Review service

We will use the product review service to add reviews for the product and also list the reviews posted by the tenant users.

```
cd saas-app-plane/product-review-service/scripts/
./test_harness.sh

```

You should receive the message (example below) upon a successful service call:

```
response: {
  "message": "1 Review added successfully"
}
```

## Product Review Service usage aggregator

Test the Product review usage aggregator, there are 5 aggregators 

1. Coarse grained metrics based on Amazon API Gateway logs
2. Amazon ECS fine grained based on [Embedded Metric Format (EMF)](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format_Specification.html)
3. [Amazon RDS Performance Insights DB Load metrics] (https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_PerfInsights.html)
4. PostgreSQL database query shared blocks read/write and execution time metrics based on [pg_stat_statements](https://www.postgresql.org/docs/current/pgstatstatements.html)
5. PostgreSQL database table size metrics

```
./test-aggregator.sh
cd ../../../
```
### Querying cost attribution

Lets now query our tenant cost attribution using the Amazon Athena. 

Navigate to Athena console and select the database `tenant_daily_usage` from the `Database` drop down in the left. You will notice four tables; `tenant_usage_coarse_grained`,  `tenant_usage_fine_grained`, `tenant_usage_split_cost_allocation_data` and `tenant_usage_s3_storage_lens_report`

Important: In the Athena Console > Query Editor change the Workgroup (on the right top) to 'saas-cost-attribution'. This workgroup will have preconfigured settings for you.

You can now query the coarse grained and fine grained metrics from Amazon Athena.

### Coarse grained
```
SELECT * FROM "tenant_daily_usage"."tenant_usage_coarse_grained" limit 10;
```

### Fine grained

```
SELECT * FROM "tenant_daily_usage"."tenant_usage_fine_grained" where service_name='Aurora' limit 10;
```

## Cleanup
Delete any stacks that were created above.


## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This library is licensed under the MIT-0 License. See the LICENSE file.