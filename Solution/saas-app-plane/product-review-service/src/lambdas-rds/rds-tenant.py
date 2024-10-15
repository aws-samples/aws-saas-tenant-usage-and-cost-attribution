import boto3
import os
import psycopg
import json

secrets_manager = boto3.client('secretsmanager')
creds_secret_name = os.getenv('DB_CRED_SECRET_NAME')                
db_name = os.getenv('DB_NAME') 

def handler(event, context):
    try:

        tenant_state = event.get('tenantState')
        tenant_id = event.get('tenantId') 
        tenant_secret_name = event.get('tenantSecretName')
                
        password, username, host, port = get_secret_value(creds_secret_name)
        tenant_password, tenant_username, tenant_host, tenant_port = get_secret_value(tenant_secret_name)

        connection = psycopg.connect(dbname=db_name,
                            host=host,
                            port=port,
                            user=username,
                            password=password,
                            autocommit=True)
    
        if tenant_state == 'PROVISION':
            with open(os.path.join(os.path.dirname(__file__), 'rds-tenant-provision.sql'), 'r') as f:
                sql_script = f.read()

            sql_script = sql_script.replace("<tenantId>",tenant_id).replace("<tenantPassword>", tenant_password).replace("<db_name>", db_name)
            
            print(sql_script)

            query(connection, sql_script)
        elif tenant_state == 'DE-PROVISION':
            query(connection, "REVOKE CONNECT ON DATABASE {0} FROM {1};".format(db_name, tenant_id))
            query(connection, "REVOKE USAGE ON SCHEMA app FROM {0};".format(tenant_id))
            query(connection, "REVOKE ALL PRIVILEGES ON table app.product_reviews FROM {0};".format(tenant_id))
            query(connection, "DROP user {0};".format(tenant_id))

        connection.close()
        
        return {
            'status': 'OK',
            'results': "Tenant Initialized"
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

