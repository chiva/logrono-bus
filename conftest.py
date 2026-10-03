"""Workspace-wide pytest options (pytest only reads ``pytest_addoption`` from the root conftest)."""

from __future__ import annotations

import pytest


def pytest_addoption(parser: pytest.Parser) -> None:
    parser.addoption(
        "--update-golden",
        action="store_true",
        help="rewrite contracts/fixtures/expected/* from the current Python output (review the diff)",
    )
