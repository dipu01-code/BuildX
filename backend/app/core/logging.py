"""Small JSON logging configuration with error identifiers and secret redaction."""

from collections.abc import Mapping
import hashlib
import json
import logging
import uuid
from datetime import datetime, timezone

SECRET_KEYS = {
    "api_key",
    "openai_api_key",
    "secret",
    "token",
    "password",
    "private_key",
    "credential",
}


def redact_value(key: str, value) -> str:
    """Return a redacted representation for sensitive keys, else the value as text."""

    if isinstance(key, str) and key.lower() in SECRET_KEYS:
        return "[REDACTED]"
    if isinstance(value, (str, int, float, bool)) or value is None:
        return json.dumps(value, ensure_ascii=False)
    return json.dumps(str(value), ensure_ascii=False)


def redact_mapping(data) -> dict:
    """Redact sensitive values from a mapping without logging the originals."""

    if not isinstance(data, Mapping):
        return {"_redacted": "non-mapping value omitted"}
    return {str(key): redact_value(key, value) for key, value in data.items()}


class JsonLogFormatter(logging.Formatter):
    """Render a stable JSON object without serializing arbitrary record fields."""

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": datetime.fromtimestamp(record.created, timezone.utc).isoformat(),
            "level": record.levelname.lower(),
            "logger": record.name,
            "message": record.getMessage(),
        }
        for key in ("method", "path", "host", "port", "error_id"):
            value = getattr(record, key, None)
            if value is not None:
                payload[key] = value
        if getattr(record, "redacted", None) is not None:
            payload["redacted"] = record.redacted
        return json.dumps(payload, separators=(",", ":"), ensure_ascii=False)


def new_error_id() -> str:
    """Return a short, stable error identifier for correlating logs and user messages."""

    return uuid.uuid4().hex[:12]


def configure_logging(level: int = logging.INFO) -> None:
    """Configure one JSON stream handler for the backend process."""

    handler = logging.StreamHandler()
    handler.setFormatter(JsonLogFormatter())
    logging.basicConfig(level=level, handlers=[handler], force=True)
