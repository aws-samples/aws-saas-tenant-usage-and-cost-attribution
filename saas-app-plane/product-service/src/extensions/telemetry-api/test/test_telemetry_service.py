import unittest
import json
import sys
import os
import io
from contextlib import redirect_stdout

sys.path.append(
    os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'telemetry_api_extension')))

from telemetry_service import (
    get_function_message_record,
    get_tenant_platform_report,
    process_function_message,
    process_platform_message,
    log_telemetry_stream,
    reset_events,
    telemetry_api
)


class TestTelemetryProcessing(unittest.TestCase):

    def setUp(self):
        # Setup initial data for testing
        self.function_message = {
            'time': '2024-06-24T19:54:26.576Z',
            'type': 'function',
            'record': '{"level":"INFO","location":"log_with_tenant_and_function_context:34","message":"Log with tenant and function context TEST1","timestamp":"2024-06-24 19:54:26,576+0000","service":"ProductService","tenant_id":"7052bcff-1c38-494b-bc42-c0e8b911950a","resource":"/product","httpMethod":"POST","consumed_capacity":{"TableName":"ServerlessSaaSAppStack-ServicesProductMicroserviceTable22695F24-MXUULXP8B42L","CapacityUnits":1.0},"type":"function.tenantUsage","awsRequestId":"7ece0de5-66fb-491a-a915-d811bf393ca1","functionName":"ServerlessSaaSAppStack-ServicesProductMicroservice-R86ttU5MHqzq","functionVersion":"$LATEST","xray_trace_id":"1-6679ceea-48c562b37e78d7a90a40d47c"}\n'
        }
        self.platform_message = {
            'time': '2024-06-24T19:54:26.615Z',
            'type': 'platform.report',
            'record': {
                'requestId': '7ece0de5-66fb-491a-a915-d811bf393ca1',
                'metrics': {
                    'durationMs': 3108.555,
                    'billedDurationMs': 3109,
                    'memorySizeMB': 128,
                    'maxMemoryUsedMB': 116,
                    'initDurationMs': 1696.708
                },
                'tracing': {
                    'spanId': '03b822ef029d89d5',
                    'type': 'X-Amzn-Trace-Id',
                    'value': 'Root=1-6679ceea-48c562b37e78d7a90a40d47c;Parent=095b3178d346f636;Sampled=1'
                },
                'status': 'success'
            }
        }

    def test_get_function_message_record(self):
        function_message = get_function_message_record(self.function_message)
        self.assertIsNotNone(function_message)
        self.assertEqual(function_message["type"], "function.tenantUsage")
        self.assertEqual(function_message["resource"], "/product")
        self.assertEqual(function_message["consumed_capacity"]["CapacityUnits"], 1.0)
        self.assertEqual(function_message["httpMethod"], "POST")
        self.assertEqual(function_message["tenant_id"], "7052bcff-1c38-494b-bc42-c0e8b911950a")
        self.assertEqual(function_message["awsRequestId"], "7ece0de5-66fb-491a-a915-d811bf393ca1")

    def test_get_tenant_platform_report(self):
        request_id = "7ece0de5-66fb-491a-a915-d811bf393ca1"
        tenant_platform_report = get_tenant_platform_report(request_id)
        self.assertIsNotNone(tenant_platform_report)
        self.assertEqual(tenant_platform_report.request_id, request_id)
        # Make sure dictionary is holding the new record.
        record = telemetry_api["events"][request_id]
        self.assertEqual(record.request_id, request_id)


    def test_process_function_message(self):
        request_id = "7ece0de5-66fb-491a-a915-d811bf393ca1"
        process_function_message(self.function_message)
        tenant_platform_report = telemetry_api['events'].get(request_id)
        self.assertIsNotNone(tenant_platform_report.request_id)
        self.assertEqual(tenant_platform_report.function_name,
                         "ServerlessSaaSAppStack-ServicesProductMicroservice-R86ttU5MHqzq")
        self.assertTrue(tenant_platform_report.has_function_logs)


    def test_process_platform_message(self):
        emf_serialized = process_platform_message(self.platform_message)
        emf_platform_report = json.loads(emf_serialized)
        self.assertIsNotNone(emf_platform_report)
        self.assertEqual(emf_platform_report["billed_duration_ms"], 3109)
        self.assertEqual(emf_platform_report["tenant_id"], "7052bcff-1c38-494b-bc42-c0e8b911950a")
        self.assertEqual(emf_platform_report["request_id"], "7ece0de5-66fb-491a-a915-d811bf393ca1")


    def test_log_telemetry_stream(self):
        messages = [self.function_message, self.platform_message]

        # Capture the EMF logged to standard output.
        captured_output = io.StringIO()
        with redirect_stdout(captured_output):
            log_telemetry_stream(messages)

        emf_serialized = captured_output.getvalue()
        emf_platform_report = json.loads(emf_serialized)

        self.assertIsNotNone(emf_platform_report)

        # Platform report.
        self.assertEqual(emf_platform_report["billed_duration_ms"], 3109)
        self.assertEqual(emf_platform_report["duration_ms"], 3108.555)
        self.assertEqual(emf_platform_report["max_memory_used_mb"], 116)

        # Tenant context.
        self.assertEqual(emf_platform_report["tenant_id"], "7052bcff-1c38-494b-bc42-c0e8b911950a")

        # Function context.
        self.assertEqual(emf_platform_report["request_id"], "7ece0de5-66fb-491a-a915-d811bf393ca1")
        self.assertEqual(emf_platform_report["function_name"], "ServerlessSaaSAppStack-ServicesProductMicroservice-R86ttU5MHqzq")
        self.assertEqual(emf_platform_report["resource"], "/product")
        self.assertEqual(emf_platform_report["http_method"], "POST")

        # DynamoDB capacity units.
        self.assertEqual(emf_platform_report["consumed_capacity"]["TableName"], "ServerlessSaaSAppStack-ServicesProductMicroserviceTable22695F24-MXUULXP8B42L")
        self.assertEqual(emf_platform_report["consumed_capacity"]["CapacityUnits"], 1)

def tearDown(self):
    reset_events()

if __name__ == '__main__':
    unittest.main()
