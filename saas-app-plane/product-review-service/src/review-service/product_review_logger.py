import logging
import os
import json
from aws_embedded_metrics import metric_scope
import logging

logger = logging.getLogger('review_svc.logger')
logger.setLevel(logging.DEBUG)

@metric_scope
async def create_emf_log(tenant_id, metric_name, metric_value, metric_unit, metrics):
    logger.info(f"inside emf logging...")
    try:
        
        metrics.put_dimensions({"Tenant": tenant_id})
        metrics.put_metric(metric_name, metric_value, metric_unit)
        await metrics.flush()
    except Exception as e:
        logger.error(f"Error creating EMF log: {e}")

