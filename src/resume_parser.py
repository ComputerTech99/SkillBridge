"""Resume PDF text extraction and text normalization utilities."""

from __future__ import annotations

import io
import re
from pathlib import Path
from typing import BinaryIO, Union

import pdfplumber

PdfInput = Union[str, Path, bytes, bytearray, memoryview, BinaryIO]

_MIN_EXTRACTED_CHARS = 30
_ZERO_WIDTH_RE = re.compile(r"[\u200b\u200c\u200d\ufeff]")
_HORIZONTAL_WS_RE = re.compile(r"[^\S\n]+")
_EXCESS_NEWLINES_RE = re.compile(r"\n{3,}")


def clean_resume_text(raw_text: str) -> str:
    """Normalize pasted or extracted resume text by collapsing irregular whitespace."""
    if not raw_text:
        return ""

    text = _ZERO_WIDTH_RE.sub("", raw_text)
    text = text.replace("\r\n", "\n").replace("\r", "\n")

    cleaned_lines = [
        _HORIZONTAL_WS_RE.sub(" ", line).strip()
        for line in text.split("\n")
    ]
    normalized = "\n".join(cleaned_lines)
    normalized = _EXCESS_NEWLINES_RE.sub("\n\n", normalized)
    return normalized.strip()


def _prepare_pdf_source(
    file_bytes_or_path: PdfInput,
) -> Union[str, Path, io.BytesIO, BinaryIO]:
    """Convert raw byte inputs to a BytesIO stream; pass paths and streams through."""
    if isinstance(file_bytes_or_path, (bytes, bytearray, memoryview)):
        return io.BytesIO(bytes(file_bytes_or_path))
    if hasattr(file_bytes_or_path, "seek") and callable(file_bytes_or_path.seek):
        try:
            file_bytes_or_path.seek(0)
        except OSError:
            pass
    return file_bytes_or_path


def extract_text_from_pdf(file_bytes_or_path: PdfInput) -> str:
    """Extract and normalize text from all pages of a PDF file path, bytes, or stream.

    Raises:
        FileNotFoundError: If a given file path does not exist.
        ValueError: If the PDF is unreadable or yields fewer than 30 characters.
    """
    if isinstance(file_bytes_or_path, (str, Path)) and not Path(file_bytes_or_path).exists():
        raise FileNotFoundError(f"PDF file not found: {file_bytes_or_path}")

    source = _prepare_pdf_source(file_bytes_or_path)

    try:
        with pdfplumber.open(source) as pdf:
            page_texts: list[str] = []
            for page in pdf.pages:
                extracted = page.extract_text()
                if extracted is not None and extracted.strip():
                    page_texts.append(extracted)
    except FileNotFoundError:
        raise
    except Exception as exc:
        raise ValueError("Empty or unreadable PDF") from exc

    cleaned = clean_resume_text("\n\n".join(page_texts))
    if len(cleaned) < _MIN_EXTRACTED_CHARS:
        raise ValueError("Empty or unreadable PDF")

    return cleaned
