"""Unit tests for shared adapter helpers (core/parser/adapters/_common.py)."""

import pytest

from app.core.coerce import as_bool
from app.core.ir.models import NodeType
from app.core.parser.adapters._common import (
    IdFactory,
    apply_declared_properties,
    infer_asset_properties,
    infer_tool_properties,
    tool_effect,
)


def test_executecode_tool_is_irreversible():
    # Code execution is not a reversible side effect.
    assert infer_tool_properties("python.run")["side_effect_reversible"] is False


def test_apply_declared_properties_only_copies_declarable_keys():
    props = infer_tool_properties("gmail.send")
    apply_declared_properties(props, {"requires_approval": True, "not_a_tool_field": "x"}, NodeType.TOOL)
    assert props["requires_approval"] is True
    assert "not_a_tool_field" not in props


def test_apply_declared_properties_accepts_every_catalogued_property():
    # Properties the rules read but the old per-adapter lists dropped.
    tool = infer_tool_properties("payments.charge")
    apply_declared_properties(tool, {"authentication_scope": "elevated", "idempotent": False}, NodeType.TOOL)
    assert tool["authentication_scope"] == "elevated"
    assert tool["idempotent"] is False

    asset = infer_asset_properties("Patients")
    apply_declared_properties(asset, {"contains_regulated_data": "gdpr"}, NodeType.DATA_ASSET)
    assert asset["contains_regulated_data"] == ["gdpr"]


def test_apply_declared_properties_ignores_null_values():
    props = infer_asset_properties("CRM records")
    apply_declared_properties(props, {"sensitivity": None}, NodeType.DATA_ASSET)
    assert props["sensitivity"] == "high"


def test_apply_declared_properties_coerces_scalar_capability_kinds():
    # A scalar capability_kinds override must become a list so tool_effect does a
    # membership test, not a substring match over a string.
    props = infer_tool_properties("do.thing")
    apply_declared_properties(props, {"capability_kinds": "send"}, NodeType.TOOL)
    assert props["capability_kinds"] == ["send"]
    assert tool_effect(props) == "send"


@pytest.mark.parametrize(
    "value,expected",
    [
        (True, True),
        (False, False),
        ("true", True),
        ("True", True),
        (" on ", True),
        ("1", True),
        ("false", False),
        ("no", False),
        ("", False),
        (1, True),
        (0, False),
        (None, False),
    ],
)
def test_as_bool_normalizes_yaml_boolean_forms(value, expected):
    assert as_bool(value) is expected


def test_id_factory_dedups_same_name_same_type():
    # A re-reference to the same artefact returns the same id so it collapses
    # into a single node (matching IRBuilder's de-dup-by-id).
    ids = IdFactory()
    first = ids.make(NodeType.DATA_ASSET, "ATS Database")
    again = ids.make(NodeType.DATA_ASSET, "ats database")  # same after normalisation
    assert first == again


def test_id_factory_distinguishes_by_node_type():
    ids = IdFactory()
    asset = ids.make(NodeType.DATA_ASSET, "Records")
    tool = ids.make(NodeType.TOOL, "Records")
    assert asset != tool


def test_id_factory_suffixes_distinct_names_that_slug_alike():
    # Two genuinely different names that slugify to the same base must get
    # distinct ids, never share one.
    ids = IdFactory()
    a = ids.make(NodeType.DATA_ASSET, "ATS-Database")
    b = ids.make(NodeType.DATA_ASSET, "ATS Database!")
    assert a != b
    assert b.startswith(a)
