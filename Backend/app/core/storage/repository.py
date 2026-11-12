"""Analysis persistence (spec section 2).

Phase 1 keeps analyses in an in-memory dict and mirrors each one to a JSON file
on disk so results survive a restart and are inspectable. No database yet.
"""

from __future__ import annotations

import logging
import os
import re
import threading
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from pydantic import ValidationError

from ..ir.models import AnalysisResult, IRValidationError

_logger = logging.getLogger("agenthound.storage")

_DEFAULT_DIR = Path(os.environ.get("AGENTHOUND_DATA_DIR", "data")).resolve()

# analysis_id reaches the repository from URL path params. Restrict it to a safe
# character set (UUIDs and slugs) so it can never contain path separators or
# ".." segments that would escape the data directory (path traversal).
_SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")


_UPDATE_LOCK_STRIPES = 64


def _is_safe_id(analysis_id: str) -> bool:
    return bool(_SAFE_ID.match(analysis_id))


class AnalysisRepository:
    def __init__(self, data_dir: Path | None = None) -> None:
        self.data_dir = data_dir or _DEFAULT_DIR
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self._cache: dict[str, AnalysisResult] = {}
        # Handlers run in FastAPI's threadpool, so several requests may touch the
        # in-memory cache concurrently. The lock guards cache access; it is not
        # held across disk I/O (the atomic temp-file replace makes writes safe).
        self._lock = threading.Lock()
        self._update_locks = [threading.Lock() for _ in range(_UPDATE_LOCK_STRIPES)]

    @contextmanager
    def locked(self, analysis_id: str) -> Iterator[None]:
        """Hold an analysis' update lock for a read-modify-write.

        Endpoints that read an analysis, change it and save it back (rename,
        analyze, delete) run inside this, so they cannot interleave and one
        cannot overwrite the other's change with a stale copy.

        The locks are striped: a fixed set shared by hashing the id, so memory
        stays bounded whatever ids arrive in URLs, and two analyses only wait
        on each other when their ids share a stripe. They are per process,
        which matches the single-process in-memory cache. Not reentrant: do
        not nest two `locked` blocks.
        """
        with self._update_locks[hash(analysis_id) % _UPDATE_LOCK_STRIPES]:
            yield

    def _path(self, analysis_id: str) -> Path:
        if not _is_safe_id(analysis_id):
            raise ValueError(f"Unsafe analysis id: {analysis_id!r}")
        return self.data_dir / f"{analysis_id}.json"

    def save(self, result: AnalysisResult) -> None:
        analysis_id = result.ir.analysis_id
        path = self._path(analysis_id)
        # Write to a unique temp file and atomically replace, so an interrupted
        # or concurrent write can never leave a truncated/corrupt JSON file.
        tmp = path.with_name(f"{path.name}.{uuid.uuid4().hex}.tmp")
        try:
            tmp.write_text(result.model_dump_json(indent=2), encoding="utf-8")
            tmp.replace(path)
        except OSError as exc:
            # Disk full, permissions, etc. Surface as a structured server-side
            # error (mapped to HTTP 500) rather than a bare FastAPI 500 that
            # would break the error-envelope contract.
            tmp.unlink(missing_ok=True)
            _logger.warning("Failed to persist analysis %s: %s", analysis_id, exc)
            raise IRValidationError(
                "STORAGE_ERROR",
                f"Failed to persist analysis {analysis_id}.",
                {"analysis_id": analysis_id},
            ) from exc
        with self._lock:
            self._cache[analysis_id] = result

    def exists(self, analysis_id: str) -> bool:
        if not _is_safe_id(analysis_id):
            return False
        with self._lock:
            if analysis_id in self._cache:
                return True
        return self._path(analysis_id).exists()

    def get(self, analysis_id: str) -> AnalysisResult | None:
        if not _is_safe_id(analysis_id):
            return None
        with self._lock:
            cached = self._cache.get(analysis_id)
        if cached is not None:
            return cached
        path = self._path(analysis_id)
        if not path.exists():
            return None
        try:
            result = AnalysisResult.model_validate_json(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            # Deleted/rotated between the exists() check and the read: treat as
            # a missing analysis (404), not a corrupt one.
            return None
        except (OSError, UnicodeDecodeError, ValidationError) as exc:
            # A stored file that cannot be read (permissions, transient IO,
            # non-UTF-8) or no longer parses/validates (manual edit or a future
            # schema change) is surfaced as a structured CORRUPT_ANALYSIS error
            # (the API layer maps this server-side fault to HTTP 500).
            _logger.warning("Corrupt stored analysis %s: %s", analysis_id, exc)
            raise IRValidationError(
                "CORRUPT_ANALYSIS",
                f"Stored analysis {analysis_id} could not be read.",
                {"analysis_id": analysis_id},
            ) from exc
        with self._lock:
            self._cache[analysis_id] = result
        return result

    def delete(self, analysis_id: str) -> bool:
        """Remove an analysis from the in-memory cache and disk.

        Returns True if the analysis existed (in cache or on disk), False if
        there was nothing to delete. A missing file is not an error (it may have
        been removed already); a genuine I/O failure surfaces as STORAGE_ERROR.
        """
        if not _is_safe_id(analysis_id):
            return False
        with self._lock:
            existed_in_cache = self._cache.pop(analysis_id, None) is not None
        existed_on_disk = False
        try:
            self._path(analysis_id).unlink()
            existed_on_disk = True
        except FileNotFoundError:
            pass
        except OSError as exc:
            _logger.warning("Failed to delete analysis %s: %s", analysis_id, exc)
            raise IRValidationError(
                "STORAGE_ERROR",
                f"Failed to delete analysis {analysis_id}.",
                {"analysis_id": analysis_id},
            ) from exc
        return existed_in_cache or existed_on_disk

    def list_all(self) -> list[AnalysisResult]:
        """Return every stored analysis, most recently uploaded first."""
        with self._lock:
            results: dict[str, AnalysisResult] = dict(self._cache)
        # The atomic-write temp files are named "<id>.json.<hex>.tmp", so the
        # "*.json" glob never matches a half-written file.
        for path in self.data_dir.glob("*.json"):
            analysis_id = path.stem
            if analysis_id in results or not _is_safe_id(analysis_id):
                continue
            try:
                result = AnalysisResult.model_validate_json(path.read_text(encoding="utf-8"))
            except (OSError, UnicodeDecodeError, ValidationError) as exc:
                _logger.warning("Skipping unreadable analysis %s while listing: %s", analysis_id, exc)
                continue
            results[analysis_id] = result
        return sorted(results.values(), key=lambda r: r.ir.metadata.uploaded_at, reverse=True)


# Module-level singleton used by the API layer.
repository = AnalysisRepository()
