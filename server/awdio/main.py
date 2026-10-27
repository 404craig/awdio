"""FastAPI app factory: routers, middleware, error handlers, lifespan and static frontend."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from . import __version__
from .api import audio, auth, documents, health, settings, voices
from .api.static import static_router
from .config import Config
from .errors import install_error_handlers
from .services import EngineFactory, build_services, default_engines

log = logging.getLogger("awdio")


def _configure_logging() -> None:
    if not log.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
        log.addHandler(handler)
        log.setLevel(logging.INFO)
        log.propagate = False


def create_app(config: Config | None = None, engines: EngineFactory = default_engines) -> FastAPI:
    _configure_logging()
    config = config or Config.from_env()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        services = build_services(config, engines)
        app.state.services = services
        services.worker.start()
        if config.warm_engines:
            for engine in services.engines.all():
                services.synth.warm(engine)
        log.info(
            "awdio %s ready (data: %s, PIN %s, audio %s)",
            __version__,
            config.data_dir,
            "on" if config.access_pin else "off",
            config.audio_format,
        )
        try:
            yield
        finally:
            services.close()

    app = FastAPI(
        title="awdio",
        version=__version__,
        lifespan=lifespan,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        redoc_url=None,
    )
    install_error_handlers(app)
    app.middleware("http")(auth.pin_middleware)
    app.add_middleware(GZipMiddleware, minimum_size=1024)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(config.dev_cors_origins),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    for module in (health, auth, documents, audio, voices, settings):
        app.include_router(module.router)
    app.include_router(static_router(config.web_dist))
    return app


app = create_app()
