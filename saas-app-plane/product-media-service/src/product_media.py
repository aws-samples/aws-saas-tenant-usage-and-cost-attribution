from flask import Flask, request, jsonify, Response
import boto3
from botocore.exceptions import NoCredentialsError, PartialCredentialsError, ClientError
import os
from jose import jwk, jwt
from jose.utils import base64url_decode

app = Flask(__name__)

def get_tenant_id(request):
    bearer_token = request.headers.get('Authorization')
    if not bearer_token:
        return None
    token = bearer_token.split(" ")[1]
    # get the tenant id from the token
    tenant_id = jwt.get_unverified_claims(token)['custom:tenantId']
    return tenant_id

@app.route('/')
def home():
    return "Welcome to ProductMedia!!"

@app.route('/health', methods=['GET'])
def health_check():
    health_status = {
        'status': 'UP',
        'details': 'Application is running smoothly!!'
    }
    return jsonify(health_status)

# Function to get S3 Bucket name from AWS Prameter Store
def get_bucketName_from_parameterstore():
        #Key value to pass to Paramter Store
        bucket_name_param_store_key = "/saasunitcost/productmedia/s3BucketName"
        ssm = boto3.client('ssm', region_name=os.environ['AWS_REGION'])
        response = ssm.get_parameter(Name=bucket_name_param_store_key, WithDecryption=False)
        return response['Parameter']['Value']

@app.route('/productmedia', methods=['POST'])
def upload_file():

    # Fetch Media File from request, if not found raise error
    if 'file' not in request.files:
        return jsonify({"error": "No file part"}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No selected file"}), 400
    if file:
        # nosec - Suppress bandit, B108: Probable insecure usage of temp file/directory, tmp file usage safe for processing media file.
        file_path = os.path.join('/tmp', file.filename)
        file.save(file_path)
    # Fetch tenant id from request header, if not found raise error
    #tenant_id = request.headers.get('tenantId')
    tenant_id = get_tenant_id(request)
    if not tenant_id:
        return jsonify({"error": "tenantId header is required"}), 400
    # Fetch ProductId from request header, if not found raise error
    product_id = request.headers.get('productId')
    if not product_id:
        return jsonify({"error": "productId header is required"}), 400
    # Fetch bucket name from AWS Systems Manager Parameter Store, if not found raise error
    bucket_name = get_bucketName_from_parameterstore()
    if not bucket_name:
        return jsonify({"error": "bucket_name environment variable is required"}), 400 
    # function call to upload file to S3
    result = upload_to_s3(file_path, bucket_name, tenant_id, product_id)
    #remove temp directory path
    os.remove(file_path)
    
    return jsonify({"message": result})

def upload_to_s3(file_path, bucket_name, tenant_id, product_id):

    # Create S3 client
    s3 = boto3.client('s3')
    try:
        # Extract the file name from the file path
        file_name = os.path.basename(file_path)
        # Construct the full S3 object key with the prefix
        s3_key = f"{tenant_id}/{product_id}_{file_name}"
        # Upload the file to S3
        s3.upload_file(file_path, bucket_name, s3_key)
        return f'Product Media File {file_name} for product {product_id} and Tenant {tenant_id}, is successfully uploaded to S3 Bucket {bucket_name}'

    except FileNotFoundError:
        return "The file was not found"
    except NoCredentialsError:
        return "Credentials not available"
    except PartialCredentialsError:
        return "Incomplete credentials provided" 

@app.route('/productmedia/<productId>/<fileName>', methods=['GET'])
def get_file(productId, fileName):
    # Fetch tenant id from request header, if not found raise error
    #tenant_id = request.headers.get('tenantId')
    tenant_id = get_tenant_id(request)
    
    if not tenant_id:
        return jsonify({"error": "tenantId header is required"}), 400
    # Fetch bucket name using the common function
    bucket_name = get_bucketName_from_parameterstore()
    if not bucket_name:
        return jsonify({"error": "bucket_name environment variable is required"}), 400
    # Construct the S3 key
    s3_key = f"{tenant_id}/{productId}_{fileName}"
    # Download the file from S3
    try:
        s3 = boto3.client('s3')
        # Get the object from S3
        s3_object = s3.get_object(Bucket=bucket_name, Key=s3_key)
        # Stream the S3 object to the client
        return Response(
            s3_object['Body'].read(),
            mimetype='application/octet-stream',
            headers={
                'Content-Disposition': f'attachment; filename={fileName}'
            }
        ) 
    except ClientError as e:
        # Check if the error is a 404 (Not Found)
        if e.response['Error']['Code'] == '404':
            return jsonify({"error": "The requested file does not exist in S3"}), 404
        else:
            # Handle other ClientErrors
            return jsonify({"error": f"An error occurred: {e.response['Error']['Message']}"}), 500
    except Exception as e:
        return jsonify({"error": f"An error occurred: {str(e)}"}), 500

if __name__ == "__main__":
    app.run("0.0.0.0", port=80, debug=False)