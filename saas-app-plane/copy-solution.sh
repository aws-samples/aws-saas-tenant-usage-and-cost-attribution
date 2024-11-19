#!/bin/bash -e

# Script to copy completed code from solutions folder to workspace directories.

# Shared services.
cp ../Solution/saas-app-plane/shared-services/src/tenant_authorizer.py shared-services/src

# Product service.
cp ../Solution/saas-app-plane/product-service/src/dal/product_service_dal.py product-service/src/dal
cp ../Solution/saas-app-plane/product-service/src/product_service.py product-service/src
cp ../Solution/saas-app-plane/product-service/src/extensions/telemetry-api/telemetry_api_extension/telemetry_service.py product-service/src/extensions/telemetry-api/telemetry_api_extension
cp ../Solution/saas-app-plane/product-service/src/fine_grained_aggregator.py product-service/src

# Product review service.
cp ../Solution/saas-app-plane/product-review-service/src/lambdas-aggregator/ecs-usage-aggregator.py product-review-service/src/lambdas-aggregator

