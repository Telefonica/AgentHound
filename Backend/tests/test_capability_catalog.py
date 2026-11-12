"""``evaluated_by`` in capabilities.yaml matches the rule code.

The annotation is maintained by hand, so this test re-derives it from the rule
modules: for every ``fh_NNN`` function it collects the verb string literals the
function uses, following module-level helpers and constants (``_DEPLOY_CAPS``,
``tool_mediated_hops``...) across the rule modules, including import aliases.
A rule that starts or stops checking a verb fails here until the catalog is
updated.
"""

from __future__ import annotations

import ast
from collections import defaultdict
from pathlib import Path

from app.core.catalogs import capability_catalog, rule_catalog

RULES_DIR = Path(__file__).resolve().parent.parent / "app" / "core" / "rules"
RULE_MODULES = ("common", "path_rules", "node_rules", "edge_rules")


def _module_definitions() -> dict[str, ast.AST]:
    """Top-level functions and constants of the rule modules, by name.

    ``from .common import x as _x`` registers ``_x`` as another name for ``x``.
    """
    definitions: dict[str, ast.AST] = {}
    aliases: dict[str, str] = {}
    for module in RULE_MODULES:
        tree = ast.parse((RULES_DIR / f"{module}.py").read_text(encoding="utf-8"))
        for node in tree.body:
            if isinstance(node, ast.FunctionDef):
                definitions[node.name] = node
            elif isinstance(node, (ast.Assign, ast.AnnAssign)):
                targets = node.targets if isinstance(node, ast.Assign) else [node.target]
                for target in targets:
                    if isinstance(target, ast.Name):
                        definitions[target.id] = node
            elif isinstance(node, ast.ImportFrom):
                for alias in node.names:
                    if alias.asname:
                        aliases[alias.asname] = alias.name
    for alias, original in aliases.items():
        if original in definitions:
            definitions.setdefault(alias, definitions[original])
    return definitions


def _verbs_used(name: str, definitions: dict[str, ast.AST], verbs: set[str], seen: set[str]) -> set[str]:
    if name in seen or name not in definitions:
        return set()
    seen.add(name)
    found: set[str] = set()
    for node in ast.walk(definitions[name]):
        if isinstance(node, ast.Constant) and node.value in verbs:
            found.add(node.value)
        elif isinstance(node, ast.Name):
            found |= _verbs_used(node.id, definitions, verbs, seen)
    return found


def _derived_evaluated_by() -> dict[str, set[str]]:
    verbs = set(capability_catalog())
    definitions = _module_definitions()
    derived: dict[str, set[str]] = defaultdict(set)
    for name in definitions:
        if not name.startswith("fh_"):
            continue
        rule_id = name.replace("fh_", "FH-")
        for verb in _verbs_used(name, definitions, verbs, set()):
            derived[verb].add(rule_id)
    return derived


def test_every_verb_declares_evaluated_by():
    for verb, descriptor in capability_catalog().items():
        assert isinstance(descriptor.get("evaluated_by"), list), verb


def test_evaluated_by_references_known_rules():
    rules = set(rule_catalog())
    for verb, descriptor in capability_catalog().items():
        unknown = set(descriptor["evaluated_by"]) - rules
        assert not unknown, f"{verb}: {sorted(unknown)}"


def test_evaluated_by_matches_rule_code():
    derived = _derived_evaluated_by()
    mismatches = {
        verb: {"catalog": sorted(descriptor["evaluated_by"]), "code": sorted(derived.get(verb, set()))}
        for verb, descriptor in capability_catalog().items()
        if set(descriptor["evaluated_by"]) != derived.get(verb, set())
    }
    assert not mismatches, mismatches


def test_scanner_sees_helper_and_alias_references():
    # Guards the scanner itself: these verbs are only reachable through a
    # constant (_DEPLOY_CAPS), a shared helper (tool_mediated_hops) or an
    # import alias (_has_interpret_intent in path_rules).
    derived = _derived_evaluated_by()
    assert "FH-012" in derived["moveResource"]
    assert "FH-025" in derived["invokeTool"]
    assert "FH-015" in derived["interpretIntent"]


def test_eighteen_verbs_are_evaluated():
    evaluated = [v for v, d in capability_catalog().items() if d["evaluated_by"]]
    assert len(evaluated) == 18
    assert len(capability_catalog()) == 53
