"""Small JSON logging configuration for application-owned log records."""

import json
import logging
from datetime import datetime, timezone


class JsonLogFormatter(logging.Formatter):
    """Render a stable JSON object without serializing arbitrary record fields."""

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": datetime.fromtimestamp(record.created, timezone.utc).isoformat(),
            "level": record.levelname.lower(),
            "logger": record.name,
            "message": record.getMessage(),
        }
        for key in ("method", "path", "host", "port"):
            value = getattr(record, key, None)
            if value is not None:
                payload[key] = value
        return json.dumps(payload, separators=(",", ":"), ensure_ascii=False)


def configure_logging(level: int = logging.INFO) -> None:
    """Configure one JSON stream handler for the backend process."""

    handler = logging.StreamHandler()
    handler.setFormatter(JsonLogFormatter())
    logging.basicConfig(level=level, handlers=[handler], force=True)
