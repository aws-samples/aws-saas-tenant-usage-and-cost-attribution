# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

import os
import psycopg2
from psycopg2 import pool
import json
import boto3
from botocore.exceptions import ClientError

secrets_manager = boto3.client('secretsmanager', region_name=os.environ['AWS_REGION'])
database = os.environ['DATABASE_NAME']
# Global variable to store connection pools
# For Amazon RDS Performance Insights DBLoad metrics, need to have connections per tenant/db-user to get db-user level metrics
# so implemented global connection pools array which is array of connection pools, will create connection pool per tenant/tenantId during the first invocation
# and re-use the same connection pool for subsequent invocations. Necessary bootstarpping steps (warm-up) would avoid the initial connection pool creation latencies
# global connection pools array
global_connection_pools = {}
def get_or_create_db_pool(tenantId, logger):
    print("inside get_or_create_db_pool")
    global global_connection_pools
    if tenantId in global_connection_pools:
        logger.info(f"tenantId In global_connection_pools {tenantId}")
        return global_connection_pools[tenantId]
    if tenantId not in global_connection_pools:
        logger.info(f"tenantId not in global_connection_pools {tenantId}")
        tenant_connection_pool = None
        try:
            # get the secrets for every tenantId using the key pattern <tenantId>Credentials
            # secrets got added during tenant provisioning
            secretId=tenantId+'Credentials'
            password, host, port, username = get_secret_withSecretId(secretId, logger)
            tenant_connection_pool = pool.SimpleConnectionPool(
                        minconn=1,
                        maxconn=5,
                        host=host,
                        database=database,
                        user=username,
                        password=password,
                        port=port
                    )
            logger.info("Connection pool created successfully")
            global_connection_pools[tenantId] = tenant_connection_pool
            return tenant_connection_pool
        except (Exception, psycopg2.Error) as error:
            logger.info(f"Error while connecting to PostgreSQL {error}")

def get_secret_withSecretId(secretId, logger):
    print("inside get_secret", secretId)
    # Retrieve the secret value from Secrets Manager
    response = secrets_manager.get_secret_value(SecretId=secretId)

    #convert string to json
    secret_value = json.loads(response['SecretString'])
    password = secret_value["password"]
    host = secret_value["host"]
    port = secret_value["port"]
    username = secret_value["username"]
    logger.info(f"DB details {host}, {port}, {username}")
    return password, host, port, username