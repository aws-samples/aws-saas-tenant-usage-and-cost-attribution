# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

# Reviews class with product reviews attributes 
class Reviews:
    def __init__(self, review_id, product_id, order_id, rating, review_description, tenant_id):
        self.review_id = review_id
        self.product_id = product_id
        self.order_id = order_id
        self.rating = rating
        self.review_description = review_description
        self.tenant_id = tenant_id
        self.review_date = None
        


