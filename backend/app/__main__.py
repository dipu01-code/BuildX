"""Run the local API on an OS-assigned loopback port by default."""

import logging
import socket

import uvicorn

from app.core.config import get_settings
from app.core.logging import configure_logging
from app.main import create_app


def main() -> None:
    """Bind the configured loopback address and report the actual port."""

    settings = get_settings()
    configure_logging()
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as server_socket:
        server_socket.bind((settings.host, settings.port))
        server_socket.listen(socket.SOMAXCONN)
        server_socket.setblocking(False)
        actual_host, actual_port = server_socket.getsockname()[:2]
        logging.getLogger("buildx.server").info(
            "Backend listening",
            extra={"host": actual_host, "port": actual_port},
        )
        server = uvicorn.Server(
            uvicorn.Config(create_app(settings), log_config=None, access_log=False)
        )
        server.run(sockets=[server_socket])


if __name__ == "__main__":
    main()
