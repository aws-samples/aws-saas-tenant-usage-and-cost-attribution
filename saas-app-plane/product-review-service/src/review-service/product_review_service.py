# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

from flask import Flask, jsonify, request
import uuid
import os , json, sys
import logging
import asyncio
import time

from product_review_dal import ProductReviewRepository, DatabaseError
from product_review_logger import create_emf_log
from product_review_model import Reviews
# import init_db_pool

app = Flask(__name__)

app.logger.setLevel(logging.DEBUG)
app.logger.info("Starting Review Service with connection pool per tenant")

@app.route('/')
def home():
    return "Welcome to ProductService!!"

@app.route('/health', methods=['GET'])
def health_check():
    health_status = {
        'status': 'UP',
        'details': 'Application is running smoothly!!'
    }
    return jsonify(health_status)

@app.route('/productreview', methods=['GET'])
def get_reviews():
    start_time = time.time()

    # Get the tenantId from req header
    tenant_id = request.headers.get('tenantId')
        
    if tenant_id:
        app.logger.info(f"Tenant Id: {tenant_id}")

    if tenant_id is None:
        app.logger.error("Tenant ID not found")
        return "error"
    app.logger.info(f"Retrieving reviews for tenant: {tenant_id}")
    #Get a connection from already initialized connection pool and get reviews from database
    try:
        repo = ProductReviewRepository(app.logger)
        reviews_response = asyncio.run(repo.get_reviews(tenant_id))
        app.logger.info(f"Retrieved {len(reviews_response)} reviews for tenant: {tenant_id}")
        end_time = time.time()  # Record the end time
        execution_time = end_time - start_time  # Calculate the execution time
        asyncio.run(create_emf_log(tenant_id, "ExecutionTime", execution_time, "Seconds"))
        return jsonify(reviews_response) # Return reviews as JSON response 
    
    except Exception as e:
        app.logger.error(f"Error retrieving reviews: {e}")
        return jsonify({"error": str(e)})

@app.route('/productreview', methods=['POST'])
def add_review():
    start_time = time.time()
    execution_time = 0
    tenant_id = request.headers.get('tenantId')
    if tenant_id is None:
        app.logger.error("Tenant ID not found")
        return "Tenant ID not found"
    data = request.get_json()
    if not data:
        app.logger.error("Invalid request data")
        return "Invalid request data"
    
    # Validate input data
    product_id = data["product_id"]
    order_id = data["order_id"]
    rating = data["rating"]
    review_description = data["review_description"]

    if not all([product_id, order_id, rating, review_description]):
        return "Missing required fields"
    try: 
        review_id = str(uuid.uuid4())
        review = Reviews(review_id, product_id, order_id, rating, review_description, tenant_id)
        app.logger.info(f"Preparing to add review for tenant: {tenant_id}")
        review_repo = ProductReviewRepository(app.logger)
        response = asyncio.run(review_repo.add_review(json.dumps(review.__dict__)))
        app.logger.info(f"response:{response} ")

        if response:
            app.logger.info(f"Review {review_id} added successfully for tenant: {tenant_id}")
            end_time = time.time()  # Record the end time
            execution_time = end_time - start_time  # Calculate the execution time
            asyncio.run(create_emf_log(tenant_id, "ExecutionTime", execution_time, "Seconds"))
            return jsonify({"message": f"{response} Review added successfully"})
        else:
            app.logger.error(f"Error in add_review : 0 review added for tenant: {tenant_id}")
            return jsonify({"error": f"Error adding review: {response} records added"}), 500
    except DatabaseError as error:
        return jsonify({"error": error.error_message })   
    except Exception as e:
        app.logger.error(f"Error in add_review while adding {review_id} for tenant: {tenant_id}: {str(e)}")
        return jsonify({"error": str(e)}), 500
    
@app.route('/productreview/<review_id>', methods=['PUT'])
def update_review(review_id):
    start_time = time.time()
    execution_time = 0
    review_id = request.view_args['review_id'] # Extract review_id from URL path
    tenant_id = request.headers.get('tenantId')
    if tenant_id is None:
        app.logger.error("Tenant ID not found")
        return jsonify({"error": "Tenant ID not found"})
    
    app.logger.info(f"Preparing to update review {review_id} for tenant: {tenant_id}")
    
    # Validate input data
    app.logger.info(f"Validating input data")
    data = request.get_json()
    
    required_keys = {"product_id", "order_id", "rating", "review_description"}
    missing_keys = required_keys - set(data.keys())
    if missing_keys:
        error_msg = "Missing required fields or No valid fields provided for update: {', '.join(missing_keys)}"
        app.logger.error(error_msg)
        return None, jsonify({"error": error_msg})

    product_id = data.get("product_id")
    order_id = data.get("order_id")
    rating = data.get("rating")
    review_description = data.get("review_description")

    try:
        review = Reviews(review_id, product_id, order_id, rating, review_description, tenant_id=tenant_id)
        app.logger.info(f"Review object created: {review.review_id}")
        review_repository = ProductReviewRepository(app.logger)   
        response=asyncio.run(review_repository.update_review(review))
        app.logger.info(f"response:{response} ")
        if response:
            app.logger.info(f"Review {review_id} updated for tenant: {tenant_id}")
            end_time = time.time()  # Record the end time
            execution_time = end_time - start_time  # Calculate the execution time
            asyncio.run(create_emf_log(tenant_id, "ExecutionTime", execution_time, "Seconds"))
            return jsonify({"message": f"{response} Review updated successfully"})
        else:
            app.logger.error(f"Error updating review {review_id} for tenant: {tenant_id}")
            return jsonify({"error": "{response} reviews updated"})
    except DatabaseError as error:
        return jsonify({"error": error.error_message })        
    except Exception as e:
        app.logger.error(f"Error updating review {review_id}: {str(e)}")
        return jsonify({"Error": "Error updating review"})


@app.route('/productreview/<review_id>', methods=['DELETE'])
def delete_review(review_id):
    start_time = time.time()
    execution_time = 0
    tenant_id = request.headers.get('tenantId')
    review_id = request.view_args['review_id']
    if tenant_id is None:
        app.logger.error("Tenant ID not found")
        return "Tenant ID not found"
    
    app.logger.info(f"Preparing to delete review {review_id} for tenant: {tenant_id}")
    try:
        review_repository = ProductReviewRepository(app.logger)
        reviews_response = asyncio.run(review_repository.delete_review(review_id, tenant_id))
        app.logger.info(f"response:{reviews_response}")
        if not reviews_response:
            app.logger.error(f"Error deleting review {review_id} for tenant: {tenant_id}")
            return jsonify({"error": f"{reviews_response} Review deleted.Error deleting review"})
        end_time = time.time()  # Record the end time
        execution_time = end_time - start_time  # Calculate the execution time
        asyncio.run(create_emf_log(tenant_id, "ExecutionTime", execution_time, "Seconds"))
        app.logger.info(f"{reviews_response} Review {review_id} deleted successfully for tenant: {tenant_id}")
        return jsonify({"message": f"{reviews_response} Review deleted successfully"})
    except DatabaseError as error:
        return jsonify({"error": error.error_message })
    except Exception as error:
        app.logger.error(f"Error deleting review {review_id} for tenant: {tenant_id}")
        return jsonify({"error": f"Error deleting review {review_id}"})


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=80 ,debug=False)

