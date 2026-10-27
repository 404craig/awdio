"""Library and document endpoints: upload, list, get, rename, delete, progress."""

from __future__ import annotations

import logging
from dataclasses import replace
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from starlette.datastructures import UploadFile

from ..config import MAX_UPLOAD_BYTES
from ..db import DocumentRow, ProgressRow
from ..errors import ApiError
from ..library import LoadedDocument
from ..parsing import NoTextError, ParseError, detect_source_type
from ..services import Services, get_services
from ..tts.registry import UnknownEngine

log = logging.getLogger(__name__)
router = APIRouter()

DEFAULT_SECONDS_PER_WORD = 0.38
_COPY_CHUNK = 1024 * 1024


class TitleBody(BaseModel):
    title: str = Field(max_length=300)


class ProgressBody(BaseModel):
    blockIndex: int
    wordIndex: int


def document_row(services: Services, doc_id: str) -> DocumentRow:
    row = services.db.get_document(doc_id)
    if row is None:
        raise ApiError(404, "not_found", "no such document")
    return row


def progress_json(row: DocumentRow, progress: ProgressRow | None) -> dict[str, Any] | None:
    if progress is None:
        return None
    percent = 100.0 * progress.word_ordinal / row.word_count if row.word_count else 0.0
    return {
        "blockIndex": progress.block_index,
        "wordIndex": progress.word_index,
        "wordOrdinal": progress.word_ordinal,
        "percent": round(min(percent, 100.0), 2),
        "updatedAt": progress.updated_at,
    }


def summary_json(services: Services, row: DocumentRow) -> dict[str, Any]:
    settings = services.settings.get()
    engine, voice = settings["engine"], settings["voiceId"]
    seconds_per_word = services.db.seconds_per_word(engine, voice) or DEFAULT_SECONDS_PER_WORD
    prepare = services.prepare.summary_status(row.id, engine, voice, row.block_count)
    return {
        "id": row.id,
        "title": row.title,
        "sourceType": row.source_type,
        "wordCount": row.word_count,
        "blockCount": row.block_count,
        "pageCount": row.page_count,
        "createdAt": row.created_at,
        "lastOpenedAt": row.last_opened_at,
        "estimatedSeconds": round(row.word_count * seconds_per_word, 1),
        "progress": progress_json(row, services.db.get_progress(row.id)),
        "prepare": prepare.to_json(),
    }


@router.get("/api/documents")
def list_documents(services: Services = Depends(get_services)) -> list[dict[str, Any]]:
    return [summary_json(services, row) for row in services.db.list_documents()]


@router.post("/api/documents", status_code=201)
async def upload_document(request: Request, services: Services = Depends(get_services)) -> JSONResponse:
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_UPLOAD_BYTES + _COPY_CHUNK:
        raise ApiError(413, "file_too_large", "files can be at most 50 MB")
    async with request.form(max_files=1) as form:
        upload = form.get("file")
        if not isinstance(upload, UploadFile) or not upload.filename:
            raise ApiError(400, "bad_request", "send the document as multipart field 'file'")
        filename = upload.filename.replace("\\", "/").rsplit("/", 1)[-1]
        source_type = detect_source_type(filename, upload.content_type)
        if source_type is None:
            raise ApiError(415, "unsupported_type", "supported formats: PDF, EPUB, DOCX, TXT, Markdown")
        doc_id = services.library.new_id()
        destination = services.library.upload_path(doc_id, source_type)
        await _save_limited(upload, destination)

    try:
        row = await run_in_threadpool(services.library.add, doc_id, source_type, filename)
    except NoTextError as exc:
        raise ApiError(422, "no_text", "no readable text was found (scanned PDFs are not supported yet)") from exc
    except ParseError as exc:
        raise ApiError(422, "parse_error", str(exc)) from exc
    log.info("uploaded document %s (%s, %d words)", row.id, row.source_type, row.word_count)
    if services.config.auto_prepare:
        await run_in_threadpool(_auto_prepare, services, row)
    return JSONResponse(summary_json(services, row), status_code=201)


def _auto_prepare(services: Services, row: DocumentRow) -> None:
    """Pre-synthesise a new document with the saved voice, in document order at the lowest priority."""
    settings = services.settings.get()
    try:
        services.engines.get(settings["engine"])
    except UnknownEngine:
        return
    services.prepare.start(row.id, settings["engine"], settings["voiceId"])


async def _save_limited(upload: UploadFile, destination: Path) -> None:
    written = 0
    with destination.open("wb") as out:
        while chunk := await upload.read(_COPY_CHUNK):
            written += len(chunk)
            if written > MAX_UPLOAD_BYTES:
                break
            out.write(chunk)
    if written > MAX_UPLOAD_BYTES:
        destination.unlink(missing_ok=True)
        raise ApiError(413, "file_too_large", "files can be at most 50 MB")


@router.get("/api/documents/{doc_id}")
async def get_document(doc_id: str, services: Services = Depends(get_services)) -> dict[str, Any]:
    row = replace(document_row(services, doc_id), last_opened_at=services.db.touch_opened(doc_id))
    doc: LoadedDocument = await run_in_threadpool(services.library.load, doc_id)
    return {**summary_json(services, row), "pages": doc.pages_json()}


@router.patch("/api/documents/{doc_id}")
def rename_document(doc_id: str, body: TitleBody, services: Services = Depends(get_services)) -> dict[str, Any]:
    document_row(services, doc_id)
    title = " ".join(body.title.split())
    if not title:
        raise ApiError(400, "bad_request", "title must not be empty")
    services.db.set_title(doc_id, title)
    return summary_json(services, document_row(services, doc_id))


@router.delete("/api/documents/{doc_id}", status_code=204)
def delete_document(doc_id: str, services: Services = Depends(get_services)) -> Response:
    row = document_row(services, doc_id)
    services.prepare.cancel(doc_id)
    audio = services.db.delete_document(doc_id)
    services.cache.remove(audio)
    services.library.delete_files(doc_id, row.source_type)
    log.info("deleted document %s and %d cached audio files", doc_id, len(audio))
    return Response(status_code=204)


@router.get("/api/documents/{doc_id}/progress")
def get_progress(doc_id: str, services: Services = Depends(get_services)) -> dict[str, Any] | None:
    row = document_row(services, doc_id)
    return progress_json(row, services.db.get_progress(doc_id))


@router.put("/api/documents/{doc_id}/progress")
def put_progress(doc_id: str, body: ProgressBody, services: Services = Depends(get_services)) -> dict[str, Any] | None:
    row = document_row(services, doc_id)
    blocks = services.library.load(doc_id).blocks
    block = blocks[min(max(body.blockIndex, 0), len(blocks) - 1)]
    word = min(max(body.wordIndex, 0), block.word_count - 1)
    progress = services.db.put_progress(doc_id, block.index, word, block.word_start + word)
    return progress_json(row, progress)
