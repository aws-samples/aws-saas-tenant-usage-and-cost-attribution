# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

from i_aggregator import IAggregator
import boto3
import os
from decimal import *

from utils.aggregator_util import (
    query_cloudwatch_logs,
    get_start_date_time,
    get_end_date_time,
    get_s3_key,
    get_line_delimited_json
)

cloudformation = boto3.client('cloudformation')
logs = boto3.client('logs')
s3 = boto3.client('s3')

log_group_name = os.getenv("SERVERLESS_SAAS_API_GATEWAY_ACCESS_LOGS")
tenant_usage_bucket = os.getenv("TENANT_USAGE_BUCKET")


# This function needs to be scheduled on daily basis
class CoarseGrainedAggregator(IAggregator):
    def calculate_daily_attribution_by_tenant(self):
        start_date_time = get_start_date_time()  # previous day epoch
        end_date_time = get_end_date_time()  # current day epoch

        usage_by_tenant = self.aggregate_tenant_usage(start_date_time, end_date_time)
        print(usage_by_tenant)

        apportioned_usage = self.apportion_overall_usage_by_tenant(usage_by_tenant)
        print("CoarseGrainedAggregator apportioned_usage success: ", apportioned_usage)
        line_delimited_json = get_line_delimited_json(apportioned_usage)

        s3_key = get_s3_key('coarse_grained', 'product')
        s3.put_object(Body=str(line_delimited_json), Bucket=tenant_usage_bucket, Key=s3_key)

    def apportion_overall_usage_by_tenant(self, usage_by_tenant) -> list:
        tenant_usage = []
        total_api_calls = 0
        tenant_id = ''
        date = ''
        api_calls = 0

        for result in usage_by_tenant['results']:
            for field in result:
                if field['field'] == 'ApiCalls':
                    api_calls = int(field['value'])
            total_api_calls += api_calls

        for result in usage_by_tenant['results']:
            for field in result:
                if field['field'] == 'TenantId':
                    tenant_id = field['value']
                if field['field'] == 'date':
                    date = field['value']
                if field['field'] == 'ApiCalls':
                    api_calls = int(field['value'])

            tenant_usage.append({"tenant_id": tenant_id, "date": date, "usage_unit": "API Calls",
                                 "tenant_usage": api_calls, "total_usage": total_api_calls,
                                 "tenant_percent_usage": (api_calls / total_api_calls) * 100})

        return tenant_usage

    def aggregate_tenant_usage(self, start_date_time, end_date_time) -> dict:
        usage_by_tenant_query = 'stats count(*) as ApiCalls by tenantId as TenantId, dateceil(@timestamp, 1d) as date'

        usage_by_tenant = query_cloudwatch_logs(logs, log_group_name,
                                                usage_by_tenant_query, start_date_time, end_date_time)
        return usage_by_tenant


def lambda_handler(event, context):
    aggregator = CoarseGrainedAggregator()
    aggregator.calculate_daily_attribution_by_tenant()
