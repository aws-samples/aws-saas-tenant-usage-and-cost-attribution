# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

import boto3
import os
from decimal import *
from datetime import datetime
import json
import psycopg
from psycopg.rows import dict_row
from utils.aggregator_util import (
    get_s3_key,
    get_line_delimited_json,
    get_formatted_start_of_day
)

s3 = boto3.client('s3')
secrets_manager = boto3.client('secretsmanager')

tenant_usage_bucket = os.getenv("TENANT_USAGE_BUCKET")
secret_name = os.environ['SECRET_NAME']
db_name_fromenv = os.getenv("PRODUCT_REVIEW_DB_NAME")


def lambda_handler(event, context):
    
    try:
        get_secret_value_response = secrets_manager.get_secret_value(
            SecretId=secret_name
    )
    except Exception as e:
        # Handle the exception here
        raise e
    
    # Retrieve the secret value from the response
    secret_value = get_secret_value_response['SecretString']
    
    #Assuming the secret value is a JSON string
    secret_dict = json.loads(secret_value)
    db_password = secret_dict['password']
    db_host = secret_dict['host']
    db_name = db_name_fromenv
    db_user = secret_dict['username']
    s3_bucket = tenant_usage_bucket
    print(db_host,db_name,db_user,db_password,s3_bucket)
    # get the date to be used in the output report
    date = get_formatted_start_of_day()
    print(date)
    # Connect to the Aurora PostgreSQL database
    try:
        conn = psycopg.connect(
            host=db_host,
            dbname=db_name,
            user=db_user,
            password=db_password
        )

        # Create a cursor with RealDictCursor to get the results as a dictionary
        with conn.cursor(row_factory=dict_row) as cur:
            # Execute the SQL statement
            cur.execute("""
            select a.userid as db_user_id, b.rolname as tenant_id, sum(a.total_exec_time) as total_exec_time, 
            sum(a.shared_blks_read) as shared_blks_read, sum(a.shared_blks_written) as shared_blks_written 
            from pg_stat_statements a, pg_catalog.pg_roles b 
            where a.userid = b.oid and b.rolname not in ('rdsadmin','postgres', 'saasadmin')
            group by tenant_id, a.userid;
                """)
            # Get the results as a list of dictionaries
            results = cur.fetchall()
            print(results)
        # Upload the results to an S3 bucket as a CSV file
        total_usage_execution_time = 0.0
        total_shared_blks_written_read = 0.0
        
        # calculate the total execution time and total shared read/write block units
        for data in results:
            print("data",data)
            total_usage_execution_time +=  data['total_exec_time']
            total_shared_blks_written_read += float(data['shared_blks_read'])
            total_shared_blks_written_read += float(data['shared_blks_written'])
        
        print(total_usage_execution_time)
        print(total_shared_blks_written_read)
        ## calculate aggregate per tenant_id
        tenant_aurora_usage = []
        
        for row in results:
            print(row)
            tenant_usage_read_write_block = 0.0
            tenant_id = row['tenant_id']
            tenant_usage_execution_time = row['total_exec_time']
            tenant_usage_read_write_block = float(row['shared_blks_read'] + row['shared_blks_written'])
            print('tenant_usage_execution_time',tenant_usage_execution_time)
            print('tenant_usage_read_write_block',tenant_usage_read_write_block)
            # check if total_usage_execution_time is zero to avoid division by zero error
            if total_usage_execution_time == 0:
                total_usage_execution_time = 1
            tenant_aurora_usage.append({"tenant_id": tenant_id, "date": date, "usage_unit": "execution_duration_ms",
                "service_name": "Aurora", 
                "tenant_usage": tenant_usage_execution_time,
                "total_usage": total_usage_execution_time,
                "tenant_percent_usage": round((tenant_usage_execution_time / total_usage_execution_time) *100)
            })
            print('percentage:',(tenant_usage_execution_time / total_usage_execution_time) *100)
            # check if total_shared_blks_written_read is zero to avoid division by zero error
            if total_shared_blks_written_read == 0:
                total_shared_blks_written_read = 1
            tenant_aurora_usage.append({"tenant_id": tenant_id, "date": date, "usage_unit": "Blocks",
                "service_name": "Aurora", 
                "tenant_usage": tenant_usage_read_write_block,
                "total_usage": total_shared_blks_written_read,
                "tenant_percent_usage": round((tenant_usage_read_write_block / total_shared_blks_written_read) *100)
            })
        
        tenant_aurora_usage_line_delimited = get_line_delimited_json(tenant_aurora_usage) 
        s3_key = get_s3_key('fine_grained', 'product-review-pg_stat')
        response = s3.put_object(
                        Bucket=s3_bucket,
                        Key=s3_key,
                        Body=str(tenant_aurora_usage_line_delimited))
                
        # now that we have collected the data points we shall do pg_stat_statements_reset() so that to avoid double counting during next run
        # for lab purposes, this had been commented out. For production scenario, you can un-comment it out
        # cur.execute("""
        # SELECT pg_stat_statements_reset();
        # """)
        return {
            'statusCode': 200,
            'body': f'Data from pg_stat_statements uploaded to S3 at s3://{s3_bucket}/{s3_key}'
        }
    except Exception as e:
        print("error:", str(e))
     
    finally:
        # close the database connection
        conn.close()