"""Settings service: read, partial update, and reset of user preferences.

Preferences are non-secret and persisted in the local SQLite database. The
service tolerates missing or malformed stored documents by returning safe
defaults instead of failing.
"""

import json
import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models.settings import AppSetting
from app.schemas.settings import (
    AppSettings,
    SettingsPatch,
    SettingsRead,
    SettingsReset,
    utc_now,
)

logger = logging.getLogger("buildx.settings")

SETTINGS_KEY = "app_settings"


def _load_stored(session: Session) -> AppSettings:
    """Load settings from the database, returning defaults when absent or invalid."""

    row = session.execute(select(AppSetting).where(AppSetting.key == SETTINGS_KEY)).scalar_one_or_none()
    if row is None:
        return AppSettings()
    try:
        raw = row.value_json
        if not isinstance(raw, dict):
            logger.warning("Stored settings value is not an object; using defaults")
            return AppSettings()
        return AppSettings.from_stored(raw)
    except Exception as error:  # pydantic ValidationError or unexpected shape
        logger.warning("Stored settings are invalid; using defaults: %s", error)
        return AppSettings()


def get_settings(session: Session) -> SettingsRead:
    """Return the current typed settings (defaults when nothing is stored)."""
    return SettingsRead.from_settings(_load_stored(session))


def patch_settings(session: Session, patch: SettingsPatch) -> SettingsRead:
    """Apply a partial settings update, preserving unrelated fields."""

    current = _load_stored(session)
    updates = patch.model_dump(exclude_unset=True)
    if not updates:
        return SettingsRead.from_settings(current)

    merged = current.to_stored_dict()
    for section, values in updates.items():
        if values is None:
            continue
        section_dict = merged.get(section)
        if not isinstance(section_dict, dict):
            section_dict = {}
        section_dict.update(values)
        merged[section] = section_dict

    next_settings = AppSettings.from_stored(merged)

    row = session.execute(select(AppSetting).where(AppSetting.key == SETTINGS_KEY)).scalar_one_or_none()
    payload = next_settings.to_stored_dict()
    if row is None:
        row = AppSetting(key=SETTINGS_KEY, value_json=payload)
        session.add(row)
    else:
        row.value_json = payload
        row.updated_at = utc_now()
    session.commit()
    session.refresh(row)
    logger.info("Settings patched: %s", sorted(updates.keys()))
    return SettingsRead.from_settings(next_settings)


def reset_settings(session: Session) -> SettingsReset:
    """Reset all settings to safe defaults."""

    row = session.execute(select(AppSetting).where(AppSetting.key == SETTINGS_KEY)).scalar_one_or_none()
    defaults = AppSettings()
    payload = defaults.to_stored_dict()
    if row is None:
        row = AppSetting(key=SETTINGS_KEY, value_json=payload)
        session.add(row)
    else:
        row.value_json = payload
        row.updated_at = utc_now()
    session.commit()
    session.refresh(row)
    logger.info("Settings reset to defaults")
    return SettingsReset(version=defaults.version)
