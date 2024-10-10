import os

from telemetry_service import (
    log_telemetry_stream,
)

DISPATCH_MIN_BATCH_SIZE = int(os.getenv("DISPATCH_MIN_BATCH_SIZE"));


def dispatch_telmetery(queue, force):
    while ((not queue.empty()) and (force or queue.qsize() >= DISPATCH_MIN_BATCH_SIZE)):
        print("[telementry_dispatcher] Dispatch telemetry data")
        batch = queue.get_nowait()
        log_telemetry_stream(batch)
