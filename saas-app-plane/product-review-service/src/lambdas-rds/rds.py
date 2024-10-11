import boto3
import os
import psycopg
import json

secrets_manager = boto3.client('secretsmanager')

def handler(event, context):
    try:
        creds_secret_name = os.getenv('DB_CRED_SECRET_NAME')                
        db_name = os.getenv('DB_NAME') 
        
        password, username, host, port = get_secret_value(creds_secret_name)

        connection = psycopg.connect(dbname='postgres',
                             host=host,
                             port=port,
                             user=username,
                             password=password,
                             autocommit=True)                
        query(connection, "CREATE DATABASE {0};".format(db_name))
        connection.close()

        connection = psycopg.connect(dbname=db_name,
                            host=host,
                            port=port,
                            user=username,
                            password=password,
                            autocommit=True)
    

        with open(os.path.join(os.path.dirname(__file__), 'db-schema.sql'), 'r') as f:
            sql_script = f.read()
        print(sql_script)
        query(connection, sql_script)
        connection.close()
        
        return {
            'status': 'OK',
            'results': "RDS Initialized"
        }
    except Exception as err:
        return {
            'status': 'ERROR',
            'err': str(err),
            'message': str(err)
        }

def query(connection, sql):
    connection.execute(sql)    

def get_secret_value(secret_id):
    response = secrets_manager.get_secret_value(SecretId=secret_id)

    #convert string to json
    secret_value = json.loads(response['SecretString'])
    
    password = secret_value["password"]
    username = secret_value["username"]
    host = secret_value["host"]
    port = secret_value["port"]
    
    return password, username, host, port

