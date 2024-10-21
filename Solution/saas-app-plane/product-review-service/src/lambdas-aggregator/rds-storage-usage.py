import psycopg
import json, os
import boto3
from collections import defaultdict
from decimal import Decimal
import csv, json
from datetime import datetime
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
    schema = 'app'
    print(db_host,db_name,db_user,db_password,s3_bucket)
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
        # Create a cursor object
        cur = conn.cursor()
        
        # Get the list of tables with the 'tenant_id' column
        cur.execute("""
            SELECT relname AS table_name
            FROM pg_catalog.pg_statio_user_tables
            WHERE relname IN (
                SELECT a.table_name
                FROM information_schema.columns a
                WHERE a.column_name = 'tenant_id'
                GROUP BY a.table_name
            )
        """)
        tables = [row[0] for row in cur.fetchall()]
        
        # Initialize dictionaries to store the results
        tenant_data_size_portions = defaultdict(float)
        total_tenant_data_sizes = defaultdict(float)
        
        # Iterate over the tables
        for table_name in tables:
            # Get the table data size and tenant data counts
            # Suppress Semgrep rule for SQL injection risk: parameters are not user supplied.
            # nosemgrep sqlalchemy-execute-raw-query
            cur.execute(f"""
                WITH tenant_user_size AS (
                  SELECT
                  relname AS table_name,
                  pg_relation_size(relid) AS table_data_size
                  FROM pg_catalog.pg_statio_user_tables
                  WHERE relname = '{table_name}'
                ), tenant_user_counts AS (
                  SELECT tenant_id, count(*) AS tenant_data_count
                  FROM {schema}.{table_name}
                  GROUP BY tenant_id
                )
                SELECT
                  tus.table_name,
                  tuc.tenant_id,
                  tuc.tenant_data_count,
                  tus.table_data_size,
                  ROUND((tuc.tenant_data_count / table_total_record_count), 2) * (tus.table_data_size) AS tenant_data_size_portion
                FROM tenant_user_counts tuc
                CROSS JOIN LATERAL (
                  SELECT table_data_size, table_name
                  FROM tenant_user_size
                ) AS tus
                CROSS JOIN LATERAL (
                  SELECT sum((tenant_data_count)) AS table_total_record_count
                  FROM tenant_user_counts
                ) AS sum_data
                WINDOW w AS (PARTITION BY tuc.tenant_id)
                ORDER BY tuc.tenant_id;
            """)
            results = cur.fetchall()
        
            # Update the dictionaries with the results
            for row in results:
                tenant_id = row[1]
                print(f'table_name: {row[0]}')
                print(f'tenant_id: {row[1]}')
                print(f'tenant_data_count: {row[2]}')
                print(f'table_data_size: {row[3]}')
                print(f'tenant_data_size_portion: {row[4]}')
                tenant_data_size_portion = row[4]
                tenant_data_size_portions[tenant_id] += float(tenant_data_size_portion)
                total_tenant_data_sizes[tenant_id] += row[3]
      
            # Create the JSON data
            json_data = []
            for tenant_id, total_tenant_data_size in total_tenant_data_sizes.items():
                tenant_data_size_portion_percentage = (tenant_data_size_portions[tenant_id] / total_tenant_data_size) * 100
                json_data.append({
                    "tenant_id": tenant_id,
                    "date": date,
                    "service_name": "Aurora",
                    "usage_unit": "DataSize",
                    "tenant_usage": tenant_data_size_portions[tenant_id],
                    "total_usage": total_tenant_data_size,
                    "tenant_percent_usage": tenant_data_size_portion_percentage
                })
    
        # Upload the JSON data to an S3 bucket    
        tenant_aurora_usage_data = get_line_delimited_json(json_data)
        bucket_name = tenant_usage_bucket
        s3_key = get_s3_key('fine_grained','product-review-db-storage')
        response = s3.put_object(Body=str(tenant_aurora_usage_data), Bucket=bucket_name, Key=s3_key)
                    
        return {
            'statusCode': 200,
            'body': f'Tenant storage usage data uploaded to S3 at s3://{s3_bucket}/{s3_key}'
        }
    except Exception as e:
        print(f"Error: {e}")
        raise e
    
    finally:
        # close the database connection
        conn.close()