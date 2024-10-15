# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

import json
from utils import utils
from utils import logger
from utils import metrics_manager
import dal.order_service_dal as order_service_dal
from decimal import Decimal
from types import SimpleNamespace
from aws_lambda_powertools import Tracer

tracer = Tracer()


@tracer.capture_lambda_handler
def get_order(event, context):
    tenantId = event['requestContext']['authorizer']['tenantId']
    tracer.put_annotation(key="TenantId", value=tenantId)

    logger.log_with_tenant_context(event, "Request received to get a order")
    params = event['pathParameters']
    key = params['id']
    logger.log_with_tenant_context(event, params)
    order, consumed_capacity = order_service_dal.get_order(event, key)
    logger.log_with_tenant_and_function_context(event, context, {"consumed_capacity": consumed_capacity},
                                                "This log will be received by the Lambda extension using the Telemetry API")
    metrics_manager.record_metric(event, "SingleOrderRequested", "Count", 1)
    return utils.generate_response(order)


@tracer.capture_lambda_handler
def create_order(event, context):
    tenantId = event['requestContext']['authorizer']['tenantId']
    tracer.put_annotation(key="TenantId", value=tenantId)

    logger.log_with_tenant_context(event, "Request received to create a order")
    payload = json.loads(event['body'], object_hook=lambda d: SimpleNamespace(**d), parse_float=Decimal)
    order, consumed_capacity = order_service_dal.create_order(event, payload)
    logger.log_with_tenant_and_function_context(event, context, {"consumed_capacity": consumed_capacity},
                                                "This log will be received by the Lambda extension using the Telemetry API")
    metrics_manager.record_metric(event, "OrderCreated", "Count", 1)
    return utils.generate_response(order)


@tracer.capture_lambda_handler
def update_order(event, context):
    tenantId = event['requestContext']['authorizer']['tenantId']
    tracer.put_annotation(key="TenantId", value=tenantId)

    logger.log_with_tenant_context(event, "Request received to update a order")
    payload = json.loads(event['body'], object_hook=lambda d: SimpleNamespace(**d), parse_float=Decimal)
    params = event['pathParameters']
    key = params['id']
    order, consumed_capacity = order_service_dal.update_order(event, payload, key)
    logger.log_with_tenant_and_function_context(event, context, {"consumed_capacity": consumed_capacity},
                                                "This log will be received by the Lambda extension using the Telemetry API")
    metrics_manager.record_metric(event, "OrderUpdated", "Count", 1)
    return utils.generate_response(order)


@tracer.capture_lambda_handler
def delete_order(event, context):
    tenantId = event['requestContext']['authorizer']['tenantId']
    tracer.put_annotation(key="TenantId", value=tenantId)

    logger.log_with_tenant_context(event, "Request received to delete a order")
    params = event['pathParameters']
    key = params['id']
    response, consumed_capacity = order_service_dal.delete_order(event, key)
    logger.log_with_tenant_and_function_context(event, context, {"consumed_capacity": consumed_capacity},
                                                "This log will be received by the Lambda extension using the Telemetry API")
    metrics_manager.record_metric(event, "OrderDeleted", "Count", 1)
    return utils.create_success_response("Successfully deleted the order")


@tracer.capture_lambda_handler
def get_orders(event, context):
    tenantId = event['requestContext']['authorizer']['tenantId']
    tracer.put_annotation(key="TenantId", value=tenantId)

    logger.log_with_tenant_context(event, "Request received to get all orders")
    response = order_service_dal.get_orders(event, tenantId)
    metrics_manager.record_metric(event, "OrdersRetrieved", "Count", len(response))
    return utils.generate_response(response)
