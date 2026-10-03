"""Trim a recording made with ``logrono-bus grabar`` into committed contract fixtures.

The upstream publishes no licence, so the repository carries the smallest slice of its data that
the tests need: only the lines serving the recorded stops, without route shapes, and only a
handful of stops. Usage::

    uv run logrono-bus grabar 101 100 --salida /tmp/rec
    uv run python scripts/trim_fixtures.py /tmp/rec contracts/fixtures/upstream

Arrival files are copied verbatim (they are already small). Afterwards regenerate the expected
outputs with ``just golden`` and review the diff.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Final

EXTRA_STOPS: Final = frozenset({"28", "69", "77", "127", "803", "12", "59", "5"})
"""Stops around the Ayuntamiento kept for nearby/search tests, beyond the recorded ones."""

FULL_ROUTE_LINES: Final = frozenset({"2", "10"})
"""Lines whose every stop is kept, so the route view (bus positions) has real names and places."""

SHAPE_FIELDS: Final = ("onwardShape",)


def _ids_in(document: dict[str, Any]) -> set[str]:
    return {str(item["stopPointRef"]).lstrip("0") for item in document["result"]["arrivals"]}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("recording", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()

    stops_doc = json.loads((args.recording / "stops.json").read_text(encoding="utf-8"))
    lines_doc = json.loads((args.recording / "lines.json").read_text(encoding="utf-8"))
    arrival_files = sorted(args.recording.glob("arrivals-*.json"))

    recorded_stops = {path.stem.removeprefix("arrivals-") for path in arrival_files}
    for path in arrival_files:
        recorded_stops |= _ids_in(json.loads(path.read_text(encoding="utf-8")))
    full_route_stops = {
        str(stop["id"])
        for line in lines_doc["result"]["lines"]
        if str(line["id"]) in FULL_ROUTE_LINES
        for direction in ("asc", "desc")
        for stop in line["stops"][direction]
    }
    kept_stop_ids = recorded_stops | EXTRA_STOPS | full_route_stops

    kept_stops = [s for s in stops_doc["result"]["stops"] if str(s["id"]) in kept_stop_ids]
    # Lines come from the recorded and nearby stops only; the extra route stops would otherwise
    # drag in every line that crosses lines 2 and 10.
    kept_line_ids = {
        str(line_id)
        for stop in kept_stops
        if str(stop["id"]) in recorded_stops | EXTRA_STOPS
        for line_id in stop["lines"]
    }
    kept_lines = [line for line in lines_doc["result"]["lines"] if str(line["id"]) in kept_line_ids]
    for line in kept_lines:
        for direction in ("asc", "desc"):
            for stop in line["stops"][direction]:
                for field in SHAPE_FIELDS:
                    stop.pop(field, None)

    args.destination.mkdir(parents=True, exist_ok=True)
    outputs = {
        "lines.json": {"result": {"lines": kept_lines}},
        "stops.json": {"result": {"stops": kept_stops}},
    }
    outputs |= {path.name: json.loads(path.read_text(encoding="utf-8")) for path in arrival_files}
    for name, document in outputs.items():
        target = args.destination / name
        target.write_text(
            json.dumps(document, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
        )
        print(f"escrito {target}")


if __name__ == "__main__":
    main()
