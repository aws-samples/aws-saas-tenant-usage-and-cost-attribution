# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

import json
from utils import logger
from utils import utils


class UserRoles:
    TENANT_ADMIN = "TenantAdmin"
    TENANT_USER = "TenantUser"


def isTenantAdmin(user_role):
    if (user_role == UserRoles.TENANT_ADMIN):
        return True
    else:
        return False


def getPolicyForUser(service_identifier, tenant_id, region, aws_account_id):
    iam_policy = None

    # This method is being used by Authorizer to get appropriate policy by service identifier.
    if service_identifier == utils.Service_Identifier.PRODUCT_SERVICE.value:
        iam_policy = __getPolicyForProductService(tenant_id, region, aws_account_id)
        logger.info("getPolicyForUser PRODUCT_SERVICE iam_policy")
    elif service_identifier == utils.Service_Identifier.USER_MANAGEMENT_SERVICE.value:
        iam_policy = __getPolicyForUserManagementService(tenant_id, region, aws_account_id)
        logger.info("getPolicyForUser USER_MANAGEMENT_SERVICE iam_policy")
    elif service_identifier == utils.Service_Identifier.PRODUCT_REVIEW_SERVICE.value:
        iam_policy = __getPolicyForProductReviewService(tenant_id, region, aws_account_id)
        logger.info("getPolicyForUser PRODUCT_REVIEW_SERVICE iam_policy")

    return iam_policy


# TODO: Scope down to least privilege.
def __getPolicyForUserManagementService(tenant_id, region, aws_account_id):
    policy = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Action": "*",
                "Resource": "*"
            }
        ]
    }
    return json.dumps(policy)

# TODO: Scope down to least privilege.
def __getPolicyForProductReviewService(tenant_id, region, aws_account_id):
    policy = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Action": "*",
                "Resource": "*"
            }
        ]
    }
    return json.dumps(policy)


def __getPolicyForProductService(tenant_id, region, aws_account_id):
    policy = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Action": [
                    "dynamodb:UpdateItem",
                    "dynamodb:GetItem",
                    "dynamodb:PutItem",
                    "dynamodb:DeleteItem",
                    "dynamodb:Query"
                ],
                "Resource": [
                    "arn:aws:dynamodb:{0}:{1}:table/*".format(
                        region, aws_account_id),
                ],
                "Condition": {
                    "ForAllValues:StringLike": {
                        "dynamodb:LeadingKeys": [
                            "{0}-*".format(tenant_id)
                        ]
                    }
                }
            },
            {
                "Effect": "Allow",
                "Action": [
                    "dynamodb:UpdateItem",
                    "dynamodb:GetItem",
                    "dynamodb:PutItem",
                    "dynamodb:DeleteItem",
                    "dynamodb:Query"
                ],
                "Resource": [
                    "arn:aws:dynamodb:{0}:{1}:table/*".format(
                        region, aws_account_id),
                ],
                "Condition": {
                    "ForAllValues:StringLike": {
                        "dynamodb:LeadingKeys": [
                            "{0}-*".format(tenant_id)
                        ]
                    }
                }
            }
        ]
    }

    return json.dumps(policy)
