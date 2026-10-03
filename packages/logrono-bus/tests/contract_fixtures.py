"""Location and loader of the golden contract corpus (``contracts/fixtures``).

A plain module rather than conftest contents so parametrised tests can read the manifest at
collection time; ``pythonpath`` in the root pyproject puts this directory on ``sys.path``.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

FIXTURES = Path(__file__).resolve().parents[3] / "contracts" / "fixtures"
MANIFEST: dict[str, Any] = json.loads((FIXTURES / "manifest.json").read_text(encoding="utf-8"))
SELECTION_CASES: dict[str, Any] = json.loads(
    (FIXTURES / "selection.json").read_text(encoding="utf-8")
)


def load_fixture(relative: str) -> Any:
    return json.loads((FIXTURES / relative).read_text(encoding="utf-8"))
