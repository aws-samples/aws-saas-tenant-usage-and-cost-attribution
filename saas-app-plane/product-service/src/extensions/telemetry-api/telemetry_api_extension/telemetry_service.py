import os
import json
from datetime import datetime
import requests

DISPATCH_POST_URI = os.getenv("DISPATCH_POST_URI")


class FunctionLog:
    def __init__(self, timestamp, request_id, tags):
        self.timestamp = timestamp
        self.request_id = request_id
        self.tags = tags


class TenantPlatformReport:
    def __init__(self):
        self.resource = None
        self.http_method = None
        self.consumed_capacity = None
        self.function_name = None
        self.function_version = None
        self.timestamp = None
        self.request_id = None
        self.duration_ms = None
        self.billed_duration_ms = None
        self.memory_size_mb = None
        self.max_memory_used_mb = None
        self.tenant_id = None
        self.tier = None
        self.has_platform_report = False
        self.has_function_logs = False


MESSAGE_TYPES = {
    'PLATFORM_START': 'platform.start',
    'PLATFORM_REPORT': 'platform.report',
    'FUNCTION': 'function',
    'TENANT_LOG': 'function.tenantUsage'
}

telemetry_api = {
    'events': {}
}


def get_emf_log(tenant_platform_report):
    name_space = f"{tenant_platform_report.function_name}-platform-report-metrics"
    emf = {
        "_aws": {
            "Timestamp": int(datetime.now().timestamp() * 1000),
            "CloudWatchMetrics": [{
                "Namespace": name_space,
                "Dimensions": [
                    ["function_name", "tenant_id", "tier"]
                ],
                "Metrics": [{
                    "Name": "max_memory_used_mb",
                    "Unit": "Megabytes"
                }]
            }]
        },
        "billed_duration_ms": tenant_platform_report.billed_duration_ms,
        "duration_ms": tenant_platform_report.duration_ms,
        "resource": tenant_platform_report.resource,
        "http_method": tenant_platform_report.http_method,
        "consumed_capacity": tenant_platform_report.consumed_capacity,
        "function_name": tenant_platform_report.function_name,
        "function_version": tenant_platform_report.function_version,
        "invocations": 1,
        "max_memory_used_mb": tenant_platform_report.max_memory_used_mb,
        "memory_size_mb": tenant_platform_report.memory_size_mb,
        "tenant_id": tenant_platform_report.tenant_id,
        "tier": tenant_platform_report.tier,
        "request_id": tenant_platform_report.request_id
    }
    return emf


def get_function_message_record(record):
    try:
        function_log = None
        if record['type'] == MESSAGE_TYPES['FUNCTION']:
            item = json.loads(record['record'])
            if item['type'] == MESSAGE_TYPES['TENANT_LOG']:
                function_log = item
        return function_log
    except Exception as e:
        return None


def log_tenant_platform_report(tenant_platform_report):
    if tenant_platform_report.has_platform_report and tenant_platform_report.has_function_logs:
        emf = get_emf_log(tenant_platform_report)
        serialize = json.dumps(emf)

        if DISPATCH_POST_URI is None:
            #print('[telementry_dispatcher:dispatch] dispatchPostUri not found. Process telemetry batch and print to CloudWatch. REFACTOR 1:')
            print(serialize)  # Just log to stdout to be captured by log group in CloudWatch.
        else:
            # Modify the below line to dispatch/send the telemetry data to the desired choice of observability tool.
            response = requests.post(
                DISPATCH_POST_URI,
                data=json.dumps(batch),
                headers={'Content-Type': 'application/json'},
                timeout=30
            )

        del telemetry_api['events'][tenant_platform_report.request_id]  # Delete from memory.
        return serialize


def get_tenant_platform_report(request_id):
    tenant_platform_report = telemetry_api['events'].get(request_id)
    if tenant_platform_report:
        return tenant_platform_report
    else:
        tenant_platform_report = TenantPlatformReport()
        tenant_platform_report.request_id = request_id
        telemetry_api['events'][request_id] = tenant_platform_report
        return tenant_platform_report


def process_platform_message(message):
    try:
        tenant_platform_report = get_tenant_platform_report(message['record']['requestId'])
        emf = None
        if tenant_platform_report:
            tenant_platform_report.request_id = message['record']['requestId']
            tenant_platform_report.timestamp = message['time']
            #TODO Uncomment below two lines to add lambda duration to CloudWatch
            #tenant_platform_report.duration_ms = message['record']['metrics']['durationMs']
            #tenant_platform_report.billed_duration_ms = message['record']['metrics']['billedDurationMs']
            tenant_platform_report.memory_size_mb = message['record']['metrics']['memorySizeMB']
            tenant_platform_report.max_memory_used_mb = message['record']['metrics']['maxMemoryUsedMB']
            tenant_platform_report.has_platform_report = True
            emf = log_tenant_platform_report(tenant_platform_report)
        return emf
    except Exception as e:
        print('process_platform_message error: ', e)


def process_function_message(message):
    try:
        function_message = get_function_message_record(message)
        emf = None
        if function_message:
            tenant_platform_report = get_tenant_platform_report(function_message['awsRequestId'])
            tenant_platform_report.resource = function_message['resource']
            tenant_platform_report.http_method = function_message['httpMethod']
            tenant_platform_report.consumed_capacity = function_message['consumed_capacity']
            tenant_platform_report.function_name = function_message['functionName']
            tenant_platform_report.function_version = function_message['functionVersion']
            tenant_platform_report.request_id = function_message['awsRequestId']
            #TODO: Uncomment the below line to add tenant id into the Cloudwatch
            #tenant_platform_report.tenant_id = function_message['tenant_id']
            tenant_platform_report.tier = function_message['tenant_tier']
            tenant_platform_report.has_function_logs = True
            emf = log_tenant_platform_report(tenant_platform_report)
        return emf
    except Exception as e:
        print('process_function_message error: ', e)


def log_telemetry_stream(messages):
    try:
        for message in messages:
            if message['type'] == MESSAGE_TYPES['FUNCTION']:
                process_function_message(message)
            elif message['type'] == MESSAGE_TYPES['PLATFORM_REPORT']:
                process_platform_message(message)
    except Exception as e:
        print('log_telemetry_stream error: ', e)


def reset_events():
    telemetry_api['events'] = {}
