# Use the official Python image as the base image
FROM public.ecr.aws/docker/library/python:3.12-slim

# Set the working directory in the container
WORKDIR /app

# Copy the requirements file first to leverage Docker cache
COPY /resources/requirements.txt /app/resources/requirements.txt

# Install any required Python packages
RUN pip install --no-cache-dir --trusted-host pypi.python.org -r /app/resources/requirements.txt

# Copy the rest of the application code to the container
COPY review-service /app/review-service

# Expose the port the app runs on (if applicable)
EXPOSE 80

# Set the entrypoint for the container
CMD ["python", "/app/review-service/product_review_service.py"]