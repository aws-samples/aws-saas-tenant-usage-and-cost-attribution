-- Create a new user
CREATE USER "<tenantId>" WITH PASSWORD '<tenantPassword>'; 

-- Grant permissions to tenant

GRANT CONNECT ON DATABASE "<db_name>" TO "<tenantId>";
GRANT USAGE ON SCHEMA app TO "<tenantId>";
GRANT ALL PRIVILEGES ON table app.product_reviews TO "<tenantId>";

