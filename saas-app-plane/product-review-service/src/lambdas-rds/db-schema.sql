  -- Create a new schema
  CREATE SCHEMA app;

  -- Create a new table in the new schema
  CREATE TABLE app.product_reviews (
    review_id text PRIMARY KEY,
    order_id INTEGER NOT NULL ,
    product_id INTEGER NOT NULL ,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    review_description text NOT NULL,
    tenant_id TEXT NOT NULL,
    review_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT review_order_unique UNIQUE (review_id, order_id, product_id)
  );

-- enable RLS on pooled table
ALTER TABLE app.product_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_user_isolation_policy ON app.product_reviews
USING (tenant_id::TEXT = current_user);

-- enable pg_stat_statements
CREATE EXTENSION pg_stat_statements;
