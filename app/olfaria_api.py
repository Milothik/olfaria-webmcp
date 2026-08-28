#!/usr/bin/env python3
"""Servidor de Olfaria para la web desplegada y su capa WebMCP.

Sirve la web existente, entrega el corpus v4 sin modificar y expone
operaciones deterministas de lectura, sin dependencias de inferencia local.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field
import uvicorn

import olfaria_corpus as corpus
from olfaria_auth import (
    COOKIE_NAME,
    SESSION_TTL_SECONDS,
    authenticate,
    create_session,
    read_session,
    validate_runtime_configuration,
)
from olfaria_graph_service import GraphServiceError, OlfariaGraphService


ROOT = Path(__file__).resolve().parent
SITE_ROOT = ROOT / "site"
ATLAS_ROOT = SITE_ROOT / "atlas"
WEBMCP_FILE = ATLAS_ROOT / "webmcp.js"
BASE_PATH = "/" + os.environ.get("OLFARIA_BASE_PATH", "").strip("/")
if BASE_PATH == "/":
    BASE_PATH = ""
COOKIE_PATH = f"{BASE_PATH}/" if BASE_PATH else "/"
graph_service = OlfariaGraphService(corpus.load_data)


class CompareOlfemasRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    first: str = Field(min_length=1, max_length=200)
    second: str = Field(min_length=1, max_length=200)


class FindPathRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source: str = Field(min_length=1, max_length=200)
    target: str = Field(min_length=1, max_length=200)
    max_depth: int = Field(default=5, ge=1, le=6)


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=200)


@asynccontextmanager
async def lifespan(_: FastAPI):
    validate_runtime_configuration(os.environ.get("OLFARIA_HOST", "127.0.0.1"))
    status = corpus.corpus_status()
    print(
        f"[DATA] {status['source_dataset']} · "
        f"{status['olfemas']} olfemas · {status['relations']} relaciones"
    )
    yield


app = FastAPI(
    title="Olfaria WebMCP API",
    version="1.2.0",
    description="Lectura trazable del corpus Olfaria v4 y herramientas WebMCP deterministas.",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


PUBLIC_PATHS = frozenset({
    "/login",
    "/login.html",
    "/login.js",
    "/auth.css",
    "/api/auth/login",
    "/api/health",
    "/assets/brand/olfaria-o.png",
    "/favicon.svg",
})


@app.middleware("http")
async def require_authentication(request: Request, call_next):
    path = request.url.path
    session = read_session(request.cookies.get(COOKIE_NAME))
    request.state.user = session

    if path in {"/login", "/login.html"} and session:
        return RedirectResponse("./", status_code=303)
    if path not in PUBLIC_PATHS and session is None:
        if path.startswith("/api/") or path == "/webmcp.js":
            return JSONResponse(
                status_code=401,
                content={"detail": {"code": "authentication_required", "message": "Inicia sesion para acceder a Olfaria."}},
            )
        return RedirectResponse("./login", status_code=303)
    return await call_next(request)


@app.middleware("http")
async def runtime_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob:; "
        "connect-src 'self'; "
        "worker-src 'self' blob:; "
        "object-src 'none'; base-uri 'self'; frame-ancestors 'self'"
    )
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.post("/api/auth/login", tags=["auth"])
def login(credentials: LoginRequest, request: Request) -> Response:
    account = authenticate(credentials.username, credentials.password)
    if account is None:
        raise HTTPException(
            status_code=401,
            detail={"code": "invalid_credentials", "message": "Usuario o contrasena incorrectos."},
        )
    response = JSONResponse({
        "ok": True,
        "user": {"username": account.username, "role": account.role},
        "redirect": "./",
    })
    response.set_cookie(
        COOKIE_NAME,
        create_session(account),
        max_age=SESSION_TTL_SECONDS,
        httponly=True,
        secure=request.url.scheme == "https",
        samesite="strict",
        path=COOKIE_PATH,
    )
    return response


@app.get("/api/auth/me", tags=["auth"])
def current_user(request: Request) -> dict:
    return {"ok": True, "user": request.state.user}


@app.post("/api/auth/logout", tags=["auth"])
def logout() -> Response:
    response = JSONResponse({"ok": True})
    response.delete_cookie(COOKIE_NAME, path=COOKIE_PATH, samesite="strict")
    return response


def _raise_graph_error(error: GraphServiceError) -> None:
    status = 404 if error.code == "olfema_not_found" else 422
    raise HTTPException(status_code=status, detail=error.as_detail()) from error


@app.get("/api/health", tags=["estado"])
def health() -> dict:
    return {
        "ok": True,
        "version": app.version,
        "data": corpus.corpus_status(),
        "webmcp_tools": [
            "search_olfemas",
            "get_relations",
            "compare_olfemas",
            "find_path",
            "focus_nodes",
        ],
        "local_model": None,
    }


@app.get("/api/data", tags=["corpus"])
def get_data() -> dict:
    """Entrega el JSON oficial con sus nombres de campo originales."""
    return corpus.load_raw_data()


@app.get("/api/webmcp/search", tags=["webmcp"])
def webmcp_search(
    q: str = Query(min_length=1, max_length=120),
    limit: int = Query(default=8, ge=1, le=20),
) -> dict:
    try:
        return graph_service.search(q, limit=limit)
    except GraphServiceError as error:
        _raise_graph_error(error)


@app.get("/api/webmcp/relations", tags=["webmcp"])
def webmcp_relations(
    olfema: str = Query(min_length=1, max_length=200),
    depth: int = Query(default=1, ge=1, le=2),
    limit: int = Query(default=30, ge=1, le=50),
) -> dict:
    try:
        return graph_service.relations(olfema, depth=depth, limit=limit)
    except GraphServiceError as error:
        _raise_graph_error(error)


@app.post("/api/webmcp/compare", tags=["webmcp"])
def webmcp_compare(request: CompareOlfemasRequest) -> dict:
    try:
        return graph_service.compare(request.first, request.second)
    except GraphServiceError as error:
        _raise_graph_error(error)


@app.post("/api/webmcp/path", tags=["webmcp"])
def webmcp_path(request: FindPathRequest) -> dict:
    try:
        return graph_service.find_path(
            request.source,
            request.target,
            max_depth=request.max_depth,
        )
    except GraphServiceError as error:
        _raise_graph_error(error)


@app.get("/webmcp.js", response_class=FileResponse, include_in_schema=False)
def webmcp_script() -> FileResponse:
    return FileResponse(
        WEBMCP_FILE,
        media_type="text/javascript",
        headers={"Cache-Control": "no-store, max-age=0"},
    )


@app.get("/login", response_class=FileResponse, include_in_schema=False)
@app.get("/login.html", response_class=FileResponse, include_in_schema=False)
def login_page() -> FileResponse:
    return FileResponse(
        ATLAS_ROOT / "login.html",
        headers={"Cache-Control": "no-store, max-age=0"},
    )


@app.get("/login.js", response_class=FileResponse, include_in_schema=False)
def login_script() -> FileResponse:
    return FileResponse(ATLAS_ROOT / "login.js", media_type="text/javascript")


@app.get("/session.js", response_class=FileResponse, include_in_schema=False)
def session_script() -> FileResponse:
    return FileResponse(ATLAS_ROOT / "session.js", media_type="text/javascript")


@app.get("/session.css", response_class=FileResponse, include_in_schema=False)
def session_styles() -> FileResponse:
    return FileResponse(ATLAS_ROOT / "session.css", media_type="text/css")


@app.get("/auth.css", response_class=FileResponse, include_in_schema=False)
def auth_styles() -> FileResponse:
    return FileResponse(ATLAS_ROOT / "auth.css", media_type="text/css")


@app.get("/", response_class=FileResponse, include_in_schema=False)
def atlas_root() -> FileResponse:
    return FileResponse(
        ATLAS_ROOT / "index.html",
        headers={"Cache-Control": "no-store, max-age=0"},
    )


if not ATLAS_ROOT.is_dir():
    raise RuntimeError(f"No se encuentra el Crystal Neural Atlas: {ATLAS_ROOT}")

# Debe registrarse al final para que /api y /docs tengan prioridad.
app.mount("/", StaticFiles(directory=ATLAS_ROOT, html=True), name="olfaria-atlas")


if __name__ == "__main__":
    uvicorn.run(
        app,
        host=os.environ.get("OLFARIA_HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", "8000")),
    )
