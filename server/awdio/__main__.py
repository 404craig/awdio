"""`python -m awdio`: run the production server on AWDIO_HOST:AWDIO_PORT."""

import uvicorn

from .config import Config

if __name__ == "__main__":
    config = Config.from_env()
    uvicorn.run("awdio.main:app", host=config.host, port=config.port)
