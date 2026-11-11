"""Entry point for the bundled backend executable: `buildx-backend migrate|serve`."""

import sys
from pathlib import Path


def resource_dir() -> Path:
    """Folder holding alembic.ini and alembic/: PyInstaller's bundle dir, or this file's folder in development."""
    return Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))


def migrate() -> None:
    from alembic import command
    from alembic.config import Config

    config = Config(str(resource_dir() / "alembic.ini"))
    config.set_main_option("script_location", str(resource_dir() / "alembic"))
    command.upgrade(config, "head")


def main(argv: list[str] | None = None) -> None:
    args = sys.argv[1:] if argv is None else argv
    if args == ["migrate"]:
        migrate()
    elif args == ["serve"]:
        from app.__main__ import main as serve

        serve()
    else:
        sys.exit("usage: buildx-backend migrate|serve")


if __name__ == "__main__":
    main()
