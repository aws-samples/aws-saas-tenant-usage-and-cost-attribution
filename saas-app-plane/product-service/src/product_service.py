# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

import json
from utils import utils
from utils import logger
from utils import metrics_manager
import dal.product_service_dal as product_service_dal
from decimal import Decimal
from aws_lambda_powertools import Tracer
from types import SimpleNamespace
import base64

tracer = Tracer()


@tracer.capture_lambda_handler
def get_product(event, context):
    tenantId = event['requestContext']['authorizer']['tenantId']
    tracer.put_annotation(key="TenantId", value=tenantId)

    logger.log_with_tenant_context(event, "Request received to get a product")
    params = event['pathParameters']
    logger.log_with_tenant_context(event, params)
    key = params['id']
    logger.log_with_tenant_context(event, key)
    product, consumed_capacity = product_service_dal.get_product(event, key)
    
    #TODO: uncomment the below lines 30 and 31 to add DynamoDB consumed capacity to the logs
    #logger.log_with_tenant_and_function_context(event, context, {"consumed_capacity": consumed_capacity},
    #                                             "This log will be received by the Lambda extension using the Telemetry API")
    
    metrics_manager.record_metric(event, "SingleProductRequested", "Count", 1)
    return utils.generate_response(product)


@tracer.capture_lambda_handler
def create_product(event, context):
    try:
        tenantId = event['requestContext']['authorizer']['tenantId']
        tracer.put_annotation(key="TenantId", value=tenantId)

        logger.log_with_tenant_context(event, "Request received to create a product")

        # Log the body for debugging
        logger.log_with_tenant_context(event, f"Received body: {event.get('body')}")

        # Handle base64-encoded body if necessary
        if event.get('isBase64Encoded'):
            body = base64.b64decode(event['body']).decode('utf-8')
        else:
            body = event.get('body')

        # Check if the body is empty
        if not body:
            raise ValueError("Request body is empty")

        # Try to load the body as JSON
        try:
            payload = json.loads(body, object_hook=lambda d: SimpleNamespace(**d), parse_float=Decimal)
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON format: {e}")

        product, consumed_capacity = product_service_dal.create_product(event, payload)
        logger.log_with_tenant_and_function_context(event, context, {"consumed_capacity": consumed_capacity},
                                                    "This log will be received by the Lambda extension using the Telemetry API")
        metrics_manager.record_metric(event, "ProductCreated", "Count", 1)
        return utils.generate_response(product)
    except Exception as e:
        print(f"Exception: create_product {e}")


@tracer.capture_lambda_handler
def update_product(event, context):
    tenantId = event['requestContext']['authorizer']['tenantId']
    tracer.put_annotation(key="TenantId", value=tenantId)

    logger.log_with_tenant_context(event, "Request received to update a product")
    payload = json.loads(event['body'], object_hook=lambda d: SimpleNamespace(**d), parse_float=Decimal)
    params = event['pathParameters']
    key = params['id']
    product, consumed_capacity = product_service_dal.update_product(event, payload, key)
    logger.log_with_tenant_and_function_context(event, context, {"consumed_capacity": consumed_capacity},
                                                "This log will be received by the Lambda extension using the Telemetry API")
    metrics_manager.record_metric(event, "ProductUpdated", "Count", 1)
    return utils.generate_response(product)


@tracer.capture_lambda_handler
def delete_product(event, context):
    tenantId = event['requestContext']['authorizer']['tenantId']
    tracer.put_annotation(key="TenantId", value=tenantId)

    logger.log_with_tenant_context(event, "Request received to delete a product")
    params = event['pathParameters']
    key = params['id']
    response, consumed_capacity = product_service_dal.delete_product(event, key)
    logger.log_with_tenant_and_function_context(event, context, {"consumed_capacity": consumed_capacity},
                                                "This log will be received by the Lambda extension using the Telemetry API")
    metrics_manager.record_metric(event, "ProductDeleted", "Count", 1)
    return utils.create_success_response("Successfully deleted the product")


@tracer.capture_lambda_handler
def get_products(event, context):
    tenantId = event['requestContext']['authorizer']['tenantId']
    tracer.put_annotation(key="TenantId", value=tenantId)

    logger.log_with_tenant_context(event, "Request received to get all products")
    response, consumed_capacity = product_service_dal.get_products(event, tenantId)
    metrics_manager.record_metric(event, "ProductsRetrieved", "Count", len(response))
    logger.log_with_tenant_and_function_context(event, context, {"consumed_capacity": consumed_capacity},
                                                "This log will be received by the Lambda extension using the Telemetry API")
    return utils.generate_response(response)
