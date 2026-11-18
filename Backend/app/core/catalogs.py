"""Loaders for the YAML catalogs under ``app/catalogs`` (spec section 2).

Results are cached; catalogs are static data shipped with the service.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

CATALOG_DIR = Path(__file__).resolve().parent.parent / "catalogs"


def _load_yaml(name: str) -> dict[str, Any]:
    path = CATALOG_DIR / name
    with path.open("r", encoding="utf-8") as handle:
        return yaml.safe_load(handle) or {}


@lru_cache(maxsize=1)
def capability_catalog() -> dict[str, dict[str, Any]]:
    """Capability descriptors keyed by verb, including ``evaluated_by``."""
    data = _load_yaml("capabilities.yaml")
    return dict(data.get("capabilities") or {})


def capabilities() -> set[str]:
    """Set of valid capability verbs (spec section 3)."""
    return set(capability_catalog())


@lru_cache(maxsize=1)
def node_property_catalog() -> dict[str, Any]:
    """Raw node-property catalog including safe defaults (spec section 4.2)."""
    return _load_yaml("node_properties.yaml")


def default_properties(node_type: str) -> dict[str, Any]:
    """Safe default properties for a node type (copied so callers may mutate)."""
    defaults = node_property_catalog().get("defaults", {}).get(node_type, {})
    return dict(defaults)


@lru_cache(maxsize=1)
def rule_catalog() -> dict[str, dict[str, Any]]:
    """Rule descriptors keyed by rule id (spec sections 7-8)."""
    data = _load_yaml("rules.yaml")
    return {rule["id"]: rule for rule in data.get("rules", [])}


@lru_cache(maxsize=1)
def adapter_coverage_catalog() -> list[dict[str, Any]]:
    """Per-framework rule gaps (``adapter_coverage.yaml``), in catalog order."""
    return list(_load_yaml("adapter_coverage.yaml").get("gaps") or [])


@lru_cache(maxsize=1)
def control_catalog() -> dict[str, dict[str, Any]]:
    """Control descriptors keyed by control id (spec section 11)."""
    data = _load_yaml("controls.yaml")
    return {control["id"]: control for control in data.get("controls", [])}
