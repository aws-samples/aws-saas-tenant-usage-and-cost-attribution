import time
from datetime import datetime, timedelta, time as time_obj
from decimal import *
import json


def query_cloudwatch_logs(logs, log_group_name, query_string, start_time, end_time) -> dict:
    query = logs.start_query(logGroupName=log_group_name,
                             startTime=start_time,
                             endTime=end_time,
                             queryString=query_string)

    query_results = logs.get_query_results(queryId=query["queryId"])

    while query_results['status'] == 'Running' or query_results['status'] == 'Scheduled':
        # nosem
        time.sleep(5)
        query_results = logs.get_query_results(queryId=query["queryId"])

    return query_results


def get_start_date_time():
    time_zone = datetime.now().astimezone().tzinfo
    start_date_time = int(datetime.now(tz=time_zone).date().strftime('%s'))  # current day epoch
    return start_date_time


def get_end_date_time():
    time_zone = datetime.now().astimezone().tzinfo
    end_date_time = int((datetime.now(tz=time_zone) + timedelta(days=1)).date().strftime('%s'))  # next day epoch
    return end_date_time

def get_formatted_start_of_day(input_date=None):
    if input_date is None:
        input_date = datetime.now().date()
    # If a datetime object is provided, extract the date
    elif isinstance(input_date, datetime):
        input_date = input_date.date()
    
    # Combine the date with midnight time
    start_of_day = datetime.combine(input_date, time_obj.min)
    
    # Format the datetime
    formatted_date = start_of_day.strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
    
    return formatted_date

def get_s3_key(prefix, service):
    # Get the current date and time.
    now = datetime.now()

    # Format strings for year, month, and current date.
    year = now.strftime('%Y')  # Current year like '2024'.
    month = now.strftime('%m')  # Current month like '07'.
    current_date = now.strftime('%m-%d-%Y')  # Current date like '07-30-2024'.

    # Format the key with the current year, month, and date
    key = prefix + '/year={}/month={}/{}-usage_by_tenant-{}.json'.format(year, month, service, current_date)
    return key


def get_line_delimited_json(data):
    # Initialize an empty string to hold all JSON strings.
    line_delimited_json = ""

    # Loop through each dictionary in the list, convert it to a JSON string, and append it to the string with a newline.
    for item in data:
        line_delimited_json += json.dumps(item) + "\n"

    return line_delimited_json
    