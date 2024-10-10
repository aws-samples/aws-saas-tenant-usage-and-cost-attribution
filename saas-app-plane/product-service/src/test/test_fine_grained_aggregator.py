import unittest
import sys
import os
from decimal import *

sys.path.append(
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "")))

from fine_grained_aggregator import FineGrainedAggregator
from utils.aggregator_util import get_s3_key

class TestTelemetryProcessing(unittest.TestCase):

    def setUp(self):
        self.logs_insights_query_response = {"results": [
            [{"field": "tenant_id", "value": "7052bcff-1c38-494b-bc42-c0e8b911950a"},
             {"field": "function_name", "value": "ServerlessSaaSAppStack-ServicesProductMicroservice-MjpdPS27NGWF"},
             {"field": "date", "value": "2024-07-03 00:00:00.000"}, {"field": "total_billed_duration", "value": "8110"},
             {"field": "total_capacity_units", "value": "1.5"}],
            [{"field": "tenant_id", "value": "7052bcff-1c38-494b-bc42-c0e8b911950a3"},
             {"field": "function_name", "value": "ServerlessSaaSAppStack-ServicesProductMicroservice-MjpdPS27NGWF"},
             {"field": "date", "value": "2024-07-03 00:00:00.000"}, {"field": "total_billed_duration", "value": "9875"},
             {"field": "total_capacity_units", "value": "3.5"}]

        ],
            "statistics": {"recordsMatched": 3.0, "recordsScanned": 114.0,
                           "bytesScanned": 50680.0}, "status": "Complete",
            "ResponseMetadata": {"RequestId": "747db6ba-634d-42ab-8736-c69dbfcb3391",
                                 "HTTPStatusCode": 200, "HTTPHeaders": {
                    "x-amzn-requestid": "747db6ba-634d-42ab-8736-c69dbfcb3391",
                    "content-type": "application/x-amz-json-1.1",
                    "content-length": "433", "date": "Tue, 02 Jul 2024 21:55:58 GMT"},
                                 "RetryAttempts": 0}}

    @unittest.skip("Use this to go against local environment to get data.")
    def test_aggregate_tenant_usage(self):
        aggregator = FineGrainedAggregator()
        usage_by_tenant = aggregator.calculate_daily_attribution_by_tenant()
        self.assertIsNotNone(usage_by_tenant)

    def test_apportion_overall_usage_by_tenant(self):
        # IAggregator instance to be instantiated inside Lambda function.
        aggregator = FineGrainedAggregator()
        usage_by_tenant = aggregator.apportion_overall_usage_by_tenant(self.logs_insights_query_response)
        print(usage_by_tenant)
        tenant1_consumed_capacity = usage_by_tenant[0]
        self.assertEqual(tenant1_consumed_capacity["tenant_id"], "7052bcff-1c38-494b-bc42-c0e8b911950a")
        self.assertEqual(tenant1_consumed_capacity["service_name"], "AmazonDynamoDB")
        self.assertEqual(tenant1_consumed_capacity["usage_unit"], "ConsumedCapacity")
        self.assertEqual(tenant1_consumed_capacity["tenant_usage"], 1.5)
        self.assertEqual(tenant1_consumed_capacity["total_usage"], 5.0)
        self.assertEqual(tenant1_consumed_capacity["tenant_percent_usage"], 30.0)

        tenant2_consumed_capacity = usage_by_tenant[2]
        self.assertEqual(tenant2_consumed_capacity["tenant_percent_usage"], 70.0)

        tenant1_billing_duration_ms = usage_by_tenant[1]
        self.assertEqual(tenant1_billing_duration_ms["tenant_id"], "7052bcff-1c38-494b-bc42-c0e8b911950a")
        self.assertEqual(tenant1_billing_duration_ms["service_name"], "AWSLambda")
        self.assertEqual(tenant1_billing_duration_ms["usage_unit"], "billed_duration_ms")
        self.assertEqual(tenant1_billing_duration_ms["tenant_usage"], 8110.0)
        self.assertEqual(tenant1_billing_duration_ms["total_usage"], 17985.0)
        self.assertEqual(tenant1_billing_duration_ms["tenant_percent_usage"], 45)

        tenant2_billing_duration_ms = usage_by_tenant[3]
        self.assertEqual(tenant2_billing_duration_ms["tenant_percent_usage"], 55)

    def test_get_s3_key(self):
        s3_key = get_s3_key('s3_Prefix', "service_name")
        pattern = r"^s3_Prefix/year=\d{4}/month=\d{2}/service_name-usage_by_tenant-\d{2}-\d{2}-\d{4}\.json$"
        self.assertRegex(s3_key, pattern)

if __name__ == "__main__":
    unittest.main()
