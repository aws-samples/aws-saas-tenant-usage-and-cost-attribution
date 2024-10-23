import boto3
import json
from datetime import datetime, timedelta
import os
from utils.aggregator_util import (
    get_start_date_time,
    get_end_date_time,
    get_s3_key,
    get_line_delimited_json,
    get_formatted_start_of_day
)

# Create a Performance Insights client
current_region = os.environ.get('AWS_REGION')
session = boto3.Session(region_name=current_region)
pi_client = session.client('pi')
s3 = boto3.client('s3')
tenant_usage_bucket = os.getenv("TENANT_USAGE_BUCKET")
secrets_manager = boto3.client('secretsmanager')
rds_client = boto3.client('rds')
db_instance_identifier = os.getenv("DB_IDENTIFIER")
# Set the service type and identifier for your Aurora PostgreSQL instance
service_type = 'RDS'
secret_name = os.environ['SECRET_NAME']

def lambda_handler(event, context):
    try:
        response = rds_client.describe_db_instances(DBInstanceIdentifier=db_instance_identifier)
        db_instances = response['DBInstances']      
        if len(db_instances) > 0:
            resource_id = db_instances[0]['DbiResourceId']
        else:
            raise ValueError(f"No database instance found with identifier: {db_instance_identifier}")
                             
        # Define the metric queries
        metric_queries = [
            {
                'Metric': 'db.load.avg',
                'GroupBy': {
                    'Group': 'db.user'
                }
    
            }
        ]
        # for loop to iterate with iteration_end_time decrementing by a minute every time and start_time is a minute earlier than iteration_end_time
        # Get start and end datetime for daily usage.
        start_date_time = get_start_date_time()  # current day beginning 00:00 epoch
        # convert start_date_time in epoch to datetime
        start_of_day = datetime.fromtimestamp(start_date_time)
        # end_time can not be greater than current time due to performance insights validation
        end_time = datetime.utcnow()
        # get the date to be used in the output report
        usage_date = get_formatted_start_of_day(start_of_day)
        print(f'start_of_day: {start_of_day}')
        print(f'usage_date: {usage_date}')
        print(f'end_time: {end_time}')
        tenant_daily_load = []
        total_usage=0.0
        total_tenant_db_load= {}
        # 60x24 mins iteration starts
        print('60x24 mins iteration starts new')
        for i in range(1440):  # 60x24 iterations, one for each minute in the last 24 hour
            iteration_end_time = end_time - timedelta(minutes=i)
            start_time = iteration_end_time - timedelta(minutes=1)
            
            # Ensure we don't go before the start of the day
            if start_time < start_of_day:
                break

            print(f"Iteration {i+1}:")
            # Get the resource metrics
            response = pi_client.get_resource_metrics(
                ServiceType=service_type,
                Identifier=resource_id,
                MetricQueries=metric_queries,
                StartTime=start_time,
                EndTime=iteration_end_time,
                PeriodInSeconds=1,  # Adjust the period as needed
                
            )
            # Print the DBLoad metrics for each user
            for metric_query in response['MetricList']:
                # skip if the metric_query['Key']['Dimensions'] key is not present
                if 'Dimensions' not in metric_query['Key']:
                    #print(f'No DB User Dimensions')
                    continue
                # print(metric_query['Key']['Dimensions'])
                if 'db.user.name' not in metric_query['Key']['Dimensions']:
                    #print(f'db.user.name')
                    continue
                user = metric_query['Key']['Dimensions']['db.user.name']
                print(f'User: {user}')
                # check if user is either saasadmin or rdsadmin if so continue
                if user == 'saasadmin' or user == 'rdsadmin':
                    print(f'Skip data point collection as it is DB admin user: {user}')
                    continue
                if 'DataPoints' not in metric_query:
                    continue
                data_points = metric_query['DataPoints']
                # initalize for the 1 minute time interval for the given tenant
                sum_db_load = 0.0
                for data_point in data_points:
                    if 'Value' not in data_point:
                        continue
                    value = data_point.get('Value')
                    if not isinstance(value, (int, float)):
                        continue
                    if value <= 0.0:
                        continue
                    # Now you have a numeric value greater than 0.0, you can use it
                    sum_db_load += value
                    print(f'data_point_value: {value} sum_db_load: {sum_db_load} User: {user} Start time: {start_time} End time: {iteration_end_time}')
                tenant_id = user
                if sum_db_load <= 0.0:
                    continue   
                # get the tenant_usage from the key value array so to sum for the entire 1 hour
                if tenant_id in total_tenant_db_load:
                    tenant_usage = total_tenant_db_load[tenant_id]
                else:
                    tenant_usage = 0.0
                tenant_usage += sum_db_load ### tenants dbload for the period = sum of all samples
                print(f'tenant_usage: {tenant_usage}')
                total_tenant_db_load[tenant_id] = tenant_usage
        # 60x24 mins iteration end
        print(f'total_tenant_db_load: {total_tenant_db_load}')
        print('60x24 mins iteration end')
        print('Report generation and writing start')
        usage_unit = "dbload_active_sessions"
        service_name = "AmazonRDS"
        # sum all the tenant_usage to overall total so to calculate the percentage attribution of each tenant
        total_usage=0.0
        for tenant_id, final_tenant_usage in total_tenant_db_load.items():
            print(f'tenant_id inside report writing: {tenant_id}')
            total_usage += final_tenant_usage  ## add the DB load per tenant to calculaete attribution %
        print(f'total_usage: {total_usage}')
        for tenant_id, report_tenant_usage in total_tenant_db_load.items():
            tenant_daily_load.append({
                "tenant_id": tenant_id,
                "date": usage_date,
                "usage_unit": usage_unit,
                "service_name": service_name,
                "tenant_usage": report_tenant_usage,
                "total_usage": total_usage,
                "tenant_percent_usage": round((report_tenant_usage / total_usage) *100)
            })
        print('Report generation end and writing start')

        print(json.dumps(tenant_daily_load))
        tenant_daily_load_line_delimited = get_line_delimited_json(tenant_daily_load) 
        print(tenant_daily_load_line_delimited)
        s3_key = get_s3_key('fine_grained', 'product-review-aurora_dbload_by_tenant')
        response = s3.put_object(
                        Bucket=tenant_usage_bucket,
                        Key=s3_key,
                        Body=str(tenant_daily_load_line_delimited))
                
        
        return {
            'statusCode': 200,
            'body': f'Data from pg_stat_statements uploaded to S3 at s3://{tenant_usage_bucket}/{s3_key}'
        }
    
    except Exception as e:
        print("error:", str(e))
        