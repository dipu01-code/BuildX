"""Configuration validation coverage."""

import pytest
from pydantic import ValidationError

from app.core.config import Settings


def test_settings_use_loopback_and_dynamic_port_by_default() -> None:
    settings = Settings(_env_file=None)

    assert settings.host == "127.0.0.1"
    assert settings.port == 0
    assert settings.api_prefix == "/api/v1"


@pytest.mark.parametrize("host", ["0.0.0.0", "::", "192.168.1.10", "example.com"])
def test_settings_reject_non_loopback_hosts(host: str) -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, host=host)


@pytest.mark.parametrize("port", [-1, 65536])
def test_settings_reject_out_of_range_ports(port: int) -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, port=port)


@pytest.mark.parametrize("prefix", ["api/v1", "/", "/api/v1/"])
def test_settings_reject_malformed_api_prefixes(prefix: str) -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, api_prefix=prefix)


def test_settings_load_values_from_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("BUILDX_HOST", "localhost")
    monkeypatch.setenv("BUILDX_PORT", "8765")

    settings = Settings(_env_file=None)

    assert settings.host == "localhost"
    assert settings.port == 8765
