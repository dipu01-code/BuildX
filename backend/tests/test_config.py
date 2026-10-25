"""Configuration validation coverage."""

import pytest
from pydantic import SecretStr, ValidationError

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


def test_ai_settings_load_the_backend_credential_and_keep_it_out_of_repr(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("BUILDX_OPENAI_API_KEY", "sk-local-test")
    monkeypatch.setenv("BUILDX_AI_MODEL", "gpt-5.4-mini")

    settings = Settings(_env_file=None)

    assert settings.openai_api_key == SecretStr("sk-local-test")
    assert settings.ai_model == "gpt-5.4-mini"
    assert "sk-local-test" not in repr(settings)


@pytest.mark.parametrize("model", ["", "https://example.com", "../secret", " model with spaces"])
def test_ai_settings_reject_invalid_model_identifiers(model: str) -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, ai_model=model)


def test_ai_settings_reject_unimplemented_provider() -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, ai_provider="other")
