import json
import logging

from app.core.logging import configure_logging


def test_configure_logging_writes_json_to_rotating_file(tmp_path):
    log_file = tmp_path / "logs" / "backend.log"
    try:
        configure_logging(log_file=log_file)
        logging.getLogger("buildx.test").info("hello file", extra={"error_id": "abc123"})
        for handler in logging.getLogger().handlers:
            handler.flush()
        record = json.loads(log_file.read_text(encoding="utf-8").strip().splitlines()[-1])
        assert record["message"] == "hello file"
        assert record["error_id"] == "abc123"
    finally:
        configure_logging()


def test_unwritable_log_directory_falls_back_to_stderr(tmp_path):
    blocker = tmp_path / "not-a-dir"
    blocker.write_text("x", encoding="utf-8")
    try:
        configure_logging(log_file=blocker / "backend.log")
        handlers = logging.getLogger().handlers
        assert len(handlers) == 1 and isinstance(handlers[0], logging.StreamHandler)
    finally:
        configure_logging()
