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


class FineGrainedAggregator(IAggregator):
    def calculate_daily_attribution_by_tenant(self):
        # Get start and end datetime for daily usage.
        start_date_time = get_start_date_time()  # previous day epoch
        end_date_time = get_end_date_time()  # current day epoch

        # Logs Insights to retrieve aggregated fine-grained consumption metrics for billing duration and DynamoDB Capacity units.
        usage_by_tenant = self.aggregate_tenant_usage(start_date_time, end_date_time)
        apportioned_usage = self.apportion_overall_usage_by_tenant(usage_by_tenant)

        line_delimited_json = get_line_delimited_json(apportioned_usage)
        s3_key = get_s3_key('fine_grained', 'product')
        s3.put_object(Body=str(line_delimited_json), Bucket=tenant_usage_bucket, Key=s3_key)

        return apportioned_usage

    def apportion_overall_usage_by_tenant(self, usage_by_tenant) -> list:
        tenant_usage = []
        total_billed_duration = 0
        total_capacity_units = 0
        tenant_id = ''
        date = ''
        tenant_total_billed_duration = 0
        tenant_total_capacity_units = 0
        # Get current date and time
        current_datetime = datetime.utcnow()
        # Convert to string in a formats
        timestamp_of_report_creation = current_datetime.strftime("%Y-%m-%d %H:%M:%S")
        # Calculate totals first.
        for result in usage_by_tenant['results']:
            for field in result:
                if field['field'] == 'total_billed_duration':
                    total_billed_duration += float(field['value'])
                if field['field'] == 'total_capacity_units':
                    total_capacity_units += float(field['value'])

        # Iterate results per tenant.
        for result in usage_by_tenant['results']:
            for field in result:
                if field['field'] == 'tenant_id':
                    tenant_id = field['value']
                if field['field'] == 'date':
                    date = field['value']
                if field['field'] == 'total_billed_duration':
                    tenant_total_billed_duration = float(field['value'])
                if field['field'] == 'total_capacity_units':
                    tenant_total_capacity_units = float(field['value'])

            # DynamoDB CapacityUnits.
            tenant_usage.append({"tenant_id": tenant_id, "date": timestamp_of_report_creation, "usage_unit": "ConsumedCapacity",
                                 "service_name": "AmazonDynamoDB",
                                 "tenant_usage": tenant_total_capacity_units, "total_usage": total_capacity_units,
                                 "tenant_percent_usage": (tenant_total_capacity_units / total_capacity_units) * 100})

            # Lambda billed_duration_ms.
            tenant_usage.append({"tenant_id": tenant_id, "date": timestamp_of_report_creation, "usage_unit": "billed_duration_ms",
                                 "service_name": "AWSLambda",
                                 "tenant_usage": tenant_total_billed_duration, "total_usage": total_billed_duration,
                                 "tenant_percent_usage": round(
                                     (tenant_total_billed_duration / total_billed_duration) * 100)})

        return tenant_usage

    def aggregate_tenant_usage(self, start_date_time, end_date_time) -> dict:
        usage_by_tenant_query = "fields _aws.Timestamp, tenant_id, function_name, billed_duration_ms, consumed_capacity.CapacityUnits "
        usage_by_tenant_query += "| filter ispresent(function_name)"
        usage_by_tenant_query += "| stats sum(billed_duration_ms) as total_billed_duration, sum(consumed_capacity.CapacityUnits) as total_capacity_units by tenant_id, datefloor(_aws.Timestamp, 1d) as date"
        usage_by_tenant_query += "| sort by tenant_id "

        usage_by_tenant = query_cloudwatch_logs(logs, "serverless-services-log-group",
                                                usage_by_tenant_query, start_date_time, end_date_time)
        return usage_by_tenant


def lambda_handler(event, context):
    aggregator = FineGrainedAggregator()
    tenant_usage = aggregator.calculate_daily_attribution_by_tenant()
