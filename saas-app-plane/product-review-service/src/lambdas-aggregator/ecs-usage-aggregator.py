from i_aggregator import IAggregator
import boto3
import os
from datetime import datetime

from utils.aggregator_util import (
    query_cloudwatch_logs,
    get_start_date_time,
    get_end_date_time,
    get_s3_key,
    get_line_delimited_json
)

logs = boto3.client('logs')
s3 = boto3.client('s3')

tenant_usage_bucket = os.getenv("TENANT_USAGE_BUCKET")
ecs_log_group = os.getenv("ECS_CLOUDWATCH_LOG_GROUP")

class FineGrainedAggregator(IAggregator):
    def calculate_daily_attribution_by_tenant(self):
        try:
            # Get start and end datetime for daily usage.
            start_date_time = get_start_date_time()  # previous day epoch
            end_date_time = get_end_date_time()  # current day epoch
    
            # Logs Insights to retrieve aggregated fine-grained consumption metrics for billing duration and DynamoDB Capacity units.
            usage_by_tenant = self.aggregate_tenant_usage(start_date_time, end_date_time)
            apportioned_usage = self.apportion_overall_usage_by_tenant(usage_by_tenant)
    
            line_delimited_json = get_line_delimited_json(apportioned_usage)
            s3_key = get_s3_key('fine_grained','product-review-ecs')
            s3.put_object(Body=str(line_delimited_json), Bucket=tenant_usage_bucket, Key=s3_key)
            return {
                'statusCode': 200,
                'body': f'ECS tenant usage data  uploaded to S3 at s3://{tenant_usage_bucket}/{s3_key}'
            }
        except Exception as e:
            print("error:", str(e))
            
    def apportion_overall_usage_by_tenant(self, usage_by_tenant) -> list:
        tenant_usage = []
        total_billed_duration = 0
        tenant_id = ''
        date = ''
        tenant_total_billed_duration = 0
        # Calculate totals first.
        for result in usage_by_tenant['results']:
            for field in result:
                if field['field'] in ['ExecutionTime']:
                    total_billed_duration += float(field['value'])
                
        # Iterate results per tenant.
        for result in usage_by_tenant['results']:
            tenant_total_billed_duration = 0
            for field in result:
                if field['field'] == 'Tenant':
                    tenant_id = field['value']
                if field['field'] == 'date':
                    date = field['value']
                if field['field'] in ['ExecutionTime']:
                    tenant_total_billed_duration += float(field['value'])
                
            # ECS billed_duration_ms.
            tenant_usage.append({"tenant_id": tenant_id, "date": date, "usage_unit": "ExecutionDuration",
                                 "service_name": "ECS",
                                 "tenant_usage": tenant_total_billed_duration, "total_usage": total_billed_duration,
                                 "tenant_percent_usage": round(
                                     (tenant_total_billed_duration / total_billed_duration) * 100)})

        return tenant_usage

    def aggregate_tenant_usage(self, start_date_time, end_date_time) -> dict:
        #TODO: Uncomment the below lines to aggregate the Execution time 
        #usage_by_tenant_query = "fields Tenant, datefloor(@timestamp, 1d) as date , ServiceName, _aws.CloudWatchMetrics.0.Metrics.0.Name"
        #usage_by_tenant_query += "| filter ispresent(ExecutionTime)"
        #usage_by_tenant_query += "| stats sum(ExecutionTime) as ExecutionTime by Tenant, date, ServiceName"
        #usage_by_tenant_query += "| sort by Tenant" 
    

        usage_by_tenant = query_cloudwatch_logs(logs, ecs_log_group,
                                                usage_by_tenant_query, start_date_time, end_date_time)
        print(f'usage_by_tenant: {usage_by_tenant}')
        return usage_by_tenant

    
def lambda_handler(event, context):
    aggregator = FineGrainedAggregator()
    ecsaggregator = aggregator.calculate_daily_attribution_by_tenant()
    return 
    {
        'statusCode': 200,
        'body': 'ECS tenant usage data  uploaded to S3'
    }