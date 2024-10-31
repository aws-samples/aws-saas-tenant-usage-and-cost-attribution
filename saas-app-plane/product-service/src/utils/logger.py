# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

from aws_lambda_powertools import Logger
logger = Logger()

"""Log info messages
"""
def info(log_message):
    # logger.structure_logs(append=True, tenant_id=tenant_id)
    logger.info(log_message)

"""Log error messages
"""
def error(log_message):
    # logger.structure_logs(append=True, tenant_id=tenant_id)
    logger.error(log_message)

"""Log with tenant context. Extracts tenant context from the lambda events
"""
def log_with_tenant_context(event, log_message):
    print(event)
    logger.structure_logs(append=True, tenant_id=event['requestContext']['authorizer']['tenantId'])
    logger.info(log_message)


"""Log with tenant context. Extracts tenant context from the lambda events
"""
def log_with_tenant_and_function_context(event, context, log_dict, log_message):
    tenant_log = {
        "type": "function.tenantUsage",
        "resource": event['resource'],
        "httpMethod": event['httpMethod'],
        "tenant_id": event['requestContext']['authorizer']['tenantId'],
        "tenant_tier": event['requestContext']['authorizer']['tenantTier'],
        "functionName": context.function_name,
        "functionVersion": context.function_version,
        "awsRequestId": context.aws_request_id,
    }

    log = tenant_log | log_dict  # Merge additional log properties.
    logger.append_keys(**log)
    logger.structure_logs(append=True)
    logger.info(log_message)
