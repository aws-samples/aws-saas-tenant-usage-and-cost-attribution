#!/bin/bash

cd ../cdk

# Disable AWS CLI pagination
export AWS_PAGER=""

SHARED_SERVICES_STACK_NAME='SharedServicesStack'
PRODUCT_MEDIA_STACK_NAME="ProductMediaAppStack"

export REGION=$(aws configure get region)
echo "REGION: ${REGION}"
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "ACCOUNT_ID: ${ACCOUNT_ID}"

API_ID=$(
  aws cloudformation describe-stacks \
    --stack-name "$SHARED_SERVICES_STACK_NAME" \
    --query "Stacks[0].Outputs[?contains(OutputKey,'AppPlaneApiGatewayId')].OutputValue" \
    --output text
)
echo "API_ID: $API_ID"

# Delete resources with VPC Link integrations.
resources=$(aws apigateway get-resources --rest-api-id "$API_ID" --query "items[*].[id,path]" --output text)
while read -r resource_id resource_path; do
  # Only process resources with "/productmedia" in their path
  if [[ "$resource_path" == *"/productmedia"* ]]; then
    echo "Deleting resource ID: $resource_id with path: $resource_path"
    aws apigateway delete-resource --rest-api-id "$API_ID" --resource-id "$resource_id"
  fi
done <<<"$resources"

echo "Cleaning up resources with VPC Link integrations, please wait.... "
sleep 10

# Deploy API in order to remove stale references that prevent cdk destroy from finishing.
aws apigateway create-deployment \
  --rest-api-id "$API_ID" \
  --stage-name prod \
  --description "Product Media services deployment."

sleep 10

# Delete Tenant stacks.
echo "Querying CloudFormation stacks starting with 'ProductMediaTenantStack'..."
stacks=$(aws cloudformation describe-stacks --query "Stacks[?starts_with(StackName, 'ProductMediaTenantStack')].StackName" --output text)

# Check if any stacks are found.
if [ -z "$stacks" ]; then
  echo "No stacks found starting with 'ProductMediaTenantStack'."
fi

# Loop through and delete each tenant stack.
for stack in $stacks; do
  echo "Deleting stack: $stack"
  aws cloudformation delete-stack --stack-name "$stack"

  echo "Waiting for stack $stack to be deleted..."
  aws cloudformation wait stack-delete-complete --stack-name "$stack"

  echo "Stack $stack deleted successfully."
done

REPO_NAME="product-media-service"

# Step 1: Delete all images in the repository
echo "Deleting all images from the ECR repository: $REPO_NAME"
aws ecr batch-delete-image --repository-name "$REPO_NAME" --image-ids "$(aws ecr list-images --repository-name "$REPO_NAME" --query 'imageIds[*]' --output json)"

# Step 2: Delete the ECR repository
echo "Deleting the ECR repository: $REPO_NAME"
aws ecr delete-repository --repository-name "$REPO_NAME" --force

echo "ECR repository $REPO_NAME and its images have been deleted."

# Deregister ECS instances and delete the ECS cluster
CLUSTER_NAME=$(aws ecs list-clusters --query "clusterArns[?contains(@, 'ProductMediaAppStack')]|[0]" --output text)
if [ -z "$CLUSTER_NAME" ]; then
    echo "No ECS cluster found starting with ProductMediaAppStack."
else
    echo "Found ECS cluster: $CLUSTER_NAME"

    # List container instances in the ECS cluster
    CONTAINER_INSTANCES=$(aws ecs list-container-instances --cluster "$CLUSTER_NAME" --query "containerInstanceArns" --output text)

    if [ -z "$CONTAINER_INSTANCES" ]; then
        echo "No container instances found in the ECS cluster."
    else
        # Deregister each container instance
        for INSTANCE in $CONTAINER_INSTANCES; do
            echo "Processing container instance: $INSTANCE in cluster: $CLUSTER_NAME"

            # Step 1: List tasks running on the container instance
            TASKS=$(aws ecs list-tasks --cluster "$CLUSTER_NAME" --container-instance "$INSTANCE" --query "taskArns" --output text)

            if [ -z "$TASKS" ]; then
                echo "No running tasks on instance: $INSTANCE"
            else
                # Step 2: Stop all tasks running on the container instance
                echo "Stopping tasks on instance: $INSTANCE"
                for TASK in $TASKS; do
                    echo "Stopping task: $TASK on container instance: $INSTANCE"
                    aws ecs stop-task --cluster "$CLUSTER_NAME" --task "$TASK"
                done

                # Wait for a few seconds to ensure tasks are stopped before proceeding
                sleep 5
            fi

            # Step 3: Forcefully deregister the container instance
            echo "Forcefully deregistering container instance: $INSTANCE"
            aws ecs deregister-container-instance --cluster "$CLUSTER_NAME" --container-instance "$INSTANCE" --force
            echo "Container instance: $INSTANCE has been deregistered."
        done
    fi
fi

# Retrieve the name of the Auto Scaling Group
ASG_NAME=$(aws autoscaling describe-auto-scaling-groups \
           --query "AutoScalingGroups[?contains(AutoScalingGroupName, 'ProductMediaAppStack')].AutoScalingGroupName | [0]" \
           --output text)

# Check if an ASG name was found
if [ "$ASG_NAME" = "None" ] || [ -z "$ASG_NAME" ]; then
    echo "No Auto Scaling Group found for ProductMediaAppStack"
else
    echo "Deleting Auto Scaling Group: $ASG_NAME"

    # Delete the Auto Scaling Group
    aws autoscaling delete-auto-scaling-group \
        --auto-scaling-group-name "$ASG_NAME" \
        --force-delete

    echo "Auto Scaling Group $ASG_NAME deleted."
fi

sleep 10
echo "Completed all pre-requisite dependancy to delete the ProductMediaAppStack. Executing cdk destroy now...."
# Destroy the base stack architecture.
cdk destroy --all --require-approval never --force --region "$REGION"
