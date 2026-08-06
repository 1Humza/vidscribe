import uvicorn

from vidscribe.app import create_app
from vidscribe.config import Settings


def main() -> None:
    settings = Settings()
    uvicorn.run(
        create_app(settings),
        host=settings.host,
        port=settings.port,
        log_level="info",
    )


if __name__ == "__main__":
    main()
