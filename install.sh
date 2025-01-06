#!/bin/bash

EMAIL="user@saascostworkshop.com"

# Deploy the SaaS control plane.
cd saas-control-plane/scripts
./deploy.sh "$EMAIL"
cd ../../

# Deploy the application plane shared services.
cd saas-app-plane/shared-services/scripts/
./deploy.sh 1
cd ../../../

# Deploy the serverless product and order microservices.
cd saas-app-plane/product-service/scripts/
./deploy.sh 1
cd ../../../

# Deploy the product review service.
cd saas-app-plane/product-review-service/scripts/
./deploy.sh 1
cd ../../../

# Deploy the product media stack.
cd saas-app-plane/product-media-service/scripts/
./deploy.sh
cd ../../../