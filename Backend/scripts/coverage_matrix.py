"""Rule-coverage baseline over a folder of architecture YAML files.

Runs every ``*.yaml`` under the given directory through the same parse ->
normalize -> rules pipeline the API uses (without persisting anything) and
prints, per file, the detected framework, how many catalog rules fired, the
finding count and how many findings sit at the 10.0 score ceiling. A second
table lists, per framework, the rules that no file in that framework reached.

Intended for the multi-format case studies (the same architecture written as
generic, CrewAI, LangGraph and Dify), so the effect of an adapter or rule change
shows up as a diff between two runs:

    cd Backend
    python scripts/coverage_matrix.py <dir-with-yaml-files>
    python scripts/coverage_matrix.py ../examples --rules   # also list rule ids
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Runnable as a plain script from Backend/ without installing the package.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.catalogs import rule_catalog  # noqa: E402
from app.core.graph.builder import build_graph  # noqa: E402
from app.core.ir.models import AnalysisResult, IRValidationError  # noqa: E402
from app.core.ir.normalizer import normalize  # noqa: E402
from app.core.ir.validators import validate_ir  # noqa: E402
from app.core.parser.adapters import run_adapter  # noqa: E402
from app.core.parser.yaml_loader import detect_framework, load_yaml_text  # noqa: E402
from app.core.rules.engine import run_rules  # noqa: E402


def analyze_file(path: Path) -> AnalysisResult:
    """Parse and analyse one file in memory (no repository write, no logging)."""
    data = load_yaml_text(path.read_text(encoding="utf-8"))
    ir = run_adapter(detect_framework(data), data, analysis_id=path.stem)
    normalize(ir)
    validate_ir(ir)
    return AnalysisResult(ir=ir, findings=run_rules(build_graph(ir)))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("directory", type=Path, help="Folder to scan recursively for *.yaml files.")
    parser.add_argument("--rules", action="store_true", help="Also print the rule ids that fired per file.")
    args = parser.parse_args(argv)

    files = sorted(args.directory.rglob("*.yaml"))
    if not files:
        print(f"No *.yaml files under {args.directory}", file=sys.stderr)
        return 1

    all_rules = set(rule_catalog())
    reached: dict[str, set[str]] = {}

    print(f"{'file':48} {'framework':10} {'rules':>7} {'findings':>8} {'at 10':>6}")
    for path in files:
        label = path.relative_to(args.directory).as_posix()
        try:
            result = analyze_file(path)
        except IRValidationError as exc:
            print(f"{label:48} ERROR {exc.code}: {exc.message}")
            continue
        framework = result.ir.source_framework.value
        fired = {f.rule_id for f in result.findings}
        reached.setdefault(framework, set()).update(fired)
        at_ceiling = sum(1 for f in result.findings if f.score >= 10.0)
        print(
            f"{label:48} {framework:10} {len(fired):>3}/{len(all_rules):<3} "
            f"{len(result.findings):>8} {at_ceiling:>6}"
        )
        if args.rules:
            print(f"    {' '.join(sorted(fired))}")

    print()
    print("Rules not reached by any file, per framework:")
    for framework in sorted(reached):
        missing = sorted(all_rules - reached[framework])
        print(f"  {framework:10} ({len(missing):>2}) {' '.join(missing) or '-'}")
    frameworks = [fw for fw in reached if fw != "generic"]
    if frameworks:
        never = sorted(all_rules - set().union(*(reached[fw] for fw in frameworks)))
        print(f"  {'any non-generic':10} ({len(never):>2}) {' '.join(never) or '-'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
