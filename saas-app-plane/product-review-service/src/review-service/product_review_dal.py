# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0
import sys, os
from flask import jsonify
import psycopg2
import json
from utils import DatabaseError
from typing import List
from product_review_model import Reviews
from product_review_logger import create_emf_log
import global_db_pool
import time

class ProductReviewRepository():
    def __init__(self, logger) -> None:
        self.logger = logger
        
    async def get_reviews(self, tenant_id: str) -> List[dict]:
        self.logger.info(f"Fetching reviews for tenant with connection pool {tenant_id}")
        connection_pool = None
        try:
            connection_pool =  global_db_pool.get_or_create_db_pool(tenant_id, self.logger)
            db_conn=connection_pool.getconn()
            cursor = db_conn.cursor()
            # set role not required as we have connection pool per tenant model
            # cursor.execute("SET role = %s", (str(tenant_id),))
            self.logger.info("Thread going to sleep for 1 second so to generate good data for db load")
            cursor.execute("SELECT pg_sleep(2)")
            cursor.execute("SELECT * FROM app.product_reviews")
            results = cursor.fetchall()
            
            reviews = []
            for row in results:
                review = {
                    'review_id': row[0],
                    'product_id': row[1],
                    'order_id': row[2],
                    'rating': row[3],
                    'review_description': row[4],
                    'tenant_id': row[5],
                    'review_date': row[6]
                }
                reviews.append(review)
            
            number_of_reviews = len(reviews)
            await create_emf_log(tenant_id, "ReviewsFetched", number_of_reviews, "Count")            
            self.logger.info(f"Total reviews fetched: {number_of_reviews}")
            return reviews
        except Exception as e:
            return e
        finally:
            if connection_pool is not None: connection_pool.putconn(db_conn)
            
    
    async def add_review(self, review):
        json_reviews = json.loads(review)
        self.logger.info(f"Adding review {json_reviews['review_id']} for tenant {json_reviews['tenant_id']}")
        connection_pool = None
        try:
            connection_pool =  global_db_pool.get_or_create_db_pool(json_reviews['tenant_id'], self.logger)
            db_conn=connection_pool.getconn()
            cursor = db_conn.cursor()
            # set role not required as we have connection pool per tenant model
            # cursor.execute("SET role = %s", (str(json_reviews['tenant_id']),))
            self.logger.info("Thread going to sleep for 1 second so to generate good data for db load")
            cursor.execute("SELECT pg_sleep(2)")
            cursor.execute("INSERT INTO app.product_reviews (review_id, product_id, order_id, rating, review_description, tenant_id) VALUES (%s, %s, %s, %s, %s, %s)", 
                (json_reviews['review_id'], json_reviews['product_id'], json_reviews['order_id'], json_reviews['rating'], json_reviews['review_description'], json_reviews['tenant_id']))
            recordsAdded = cursor.rowcount
            # nosemgrep allow sleep
            time.sleep(1)  # This will make the thread wait for 1 second
            db_conn.commit()
            response = {
                "RecordsAdded": recordsAdded
            }
            self.logger.info(f"Added {response['RecordsAdded']} review record: {json_reviews['review_id']} for tenant {json_reviews['tenant_id']}")
            await create_emf_log(json_reviews['tenant_id'], "ReviewsAdded", 1, "Count")
            return response["RecordsAdded"]
        except Exception as e:
            return e       
        finally:
            if connection_pool is not None: connection_pool.putconn(db_conn)

    
    async def update_review(self, review:Reviews):
        connection_pool = None
        self.logger.info(review.review_id)
        self.logger.info(f"Updating review {review.review_id} for tenant {review.tenant_id}")
        try:
            connection_pool =  global_db_pool.get_or_create_db_pool(review.tenant_id, self.logger)
            db_conn=connection_pool.getconn()
            cursor = db_conn.cursor()
            # set role not required as we have connection pool per tenant model
            # cursor.execute("SET role = %s", (str(review.tenant_id),))
            self.logger.info("Thread going to sleep for 1 second so to generate good data for db load")
            cursor.execute("SELECT pg_sleep(2)")
            cursor.execute("UPDATE app.product_reviews SET rating = %s, review_description = %s WHERE review_id = %s AND tenant_id = %s",
                (review.rating, review.review_description, review.review_id, review.tenant_id))
            recordsUpdated = cursor.rowcount
            # nosemgrep allow sleep
            time.sleep(1)  # This will make the thread wait for 1 second
            db_conn.commit()
            response = {
                "recordsUpdated": recordsUpdated
            }
            logger.info(f"Updated {response['recordsUpdated']} review record: {review.review_id} for tenant {review.tenant_id}")
            await create_emf_log(review.tenant_id, "ReviewsUpdated", 1, "Count")
            return response["recordsUpdated"]
        except Exception as e:
            return e
        finally:
            if connection_pool is not None: connection_pool.putconn(db_conn)
                
    async def delete_review(self, review_id, tenant_id):
        connection_pool = None
        try:
            self.logger.info(f"Deleting review {review_id} for tenant {tenant_id}")
            connection_pool =  global_db_pool.get_or_create_db_pool(tenant_id, self.logger)
            db_conn=connection_pool.getconn()
            cursor = db_conn.cursor()
            # set role not required as we have connection pool per tenant model
            # cursor.execute("SET role = %s", (str(tenant_id),))
            self.logger.info("Thread going to sleep for 1 second so to generate good data for db load")
            cursor.execute("SELECT pg_sleep(2)")
            cursor.execute("DELETE FROM app.product_reviews WHERE review_id = %s AND tenant_id = %s", (review_id, tenant_id))
            recordsDeleted = cursor.rowcount
            db_conn.commit()
            response = {
                "recordsDeleted": recordsDeleted
            }
            self.logger.info(f"Deleted {response['recordsDeleted']} review record for tenant {tenant_id}")
            await create_emf_log(tenant_id, "ReviewsDeleted", 1, "Count")
            return response["recordsDeleted"]
        except Exception as e:
            return e
        finally:
            if connection_pool is not None: connection_pool.putconn(db_conn)