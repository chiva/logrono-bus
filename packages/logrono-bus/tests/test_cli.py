"""Command-line interface, end to end against a mocked upstream."""

from __future__ import annotations

import json
from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from pathlib import Path

import pytest
import time_machine
from contract_fixtures import load_fixture
from fake_upstream import FakeUpstream

from logrono_bus.__main__ import EXIT_ERROR, EXIT_OK
from logrono_bus.__main__ import main as cli_main

RECORDED_AT = datetime(2026, 10, 3, 16, 0, 45, tzinfo=UTC)


@pytest.fixture
def main(upstream: FakeUpstream) -> Iterator[Callable[[list[str]], int]]:
    """The CLI entry point, aimed at the fake upstream with its catalogue loaded."""
    upstream.serve_catalog()

    def run(argv: list[str]) -> int:
        return cli_main(["--origen", upstream.base_url, *argv])

    yield run


@pytest.fixture(autouse=True)
def frozen_time() -> Iterator[None]:
    with time_machine.travel(RECORDED_AT, tick=False):
        yield


def test_lineas_table(
    main: Callable[[list[str]], int], upstream: FakeUpstream, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["lineas"]) == EXIT_OK
    out = capsys.readouterr().out
    assert " 2  Yagüe – Varea  (#FFFF00)" in out
    assert "2:desc   Artesanos → Manresa" in out


def test_lineas_json(
    main: Callable[[list[str]], int], upstream: FakeUpstream, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["--json", "lineas"]) == EXIT_OK
    document = json.loads(capsys.readouterr().out)
    assert [line["label"] for line in document["lines"]][-2:] == ["B1", "B3"]


def test_paradas_cerca_lists_ayuntamiento(
    main: Callable[[list[str]], int], upstream: FakeUpstream, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["paradas", "--cerca", "42.4655,-2.4390", "--radio", "60"]) == EXIT_OK
    out = capsys.readouterr().out.splitlines()
    assert [line.split()[0] for line in out] == ["101", "100"]
    assert "B3" not in out[0]


def test_paradas_buscar_json_and_empty(
    main: Callable[[list[str]], int], upstream: FakeUpstream, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["--json", "paradas", "--buscar", "zubía"]) == EXIT_OK
    assert [s["id"] for s in json.loads(capsys.readouterr().out)] == ["28", "803"]


def test_paradas_buscar_without_matches(
    main: Callable[[list[str]], int], upstream: FakeUpstream, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["paradas", "--buscar", "inexistente"]) == EXIT_OK
    assert "Ninguna parada coincide" in capsys.readouterr().out


def test_paradas_rejects_bad_point(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit):
        cli_main(["paradas", "--cerca", "norte"])
    assert "LAT,LON" in capsys.readouterr().err


def test_llegadas_table_with_filter(
    main: Callable[[list[str]], int], upstream: FakeUpstream, capsys: pytest.CaptureFixture[str]
) -> None:
    upstream.serve_arrivals("101", "upstream/arrivals-101.json")
    assert main(["llegadas", "101", "--lineas", "2d"]) == EXIT_OK
    out = capsys.readouterr().out.splitlines()
    assert out[0] == "Parada 101 · Ayuntamiento · 18:00:45"
    assert all(line.strip().startswith("2 → Manresa") for line in out[1:])
    assert len(out) == 3


def test_llegadas_flags_and_empty(
    main: Callable[[list[str]], int], upstream: FakeUpstream, capsys: pytest.CaptureFixture[str]
) -> None:
    upstream.serve_arrivals("5", "upstream/arrivals-5.json")
    assert main(["llegadas", "5"]) == EXIT_OK
    out = capsys.readouterr().out
    assert "fin de trayecto" in out
    assert "programado" in out


def test_llegadas_json(
    main: Callable[[list[str]], int], upstream: FakeUpstream, capsys: pytest.CaptureFixture[str]
) -> None:
    upstream.serve_arrivals("101", "upstream/arrivals-vacio-101.json")
    assert main(["--json", "llegadas", "101"]) == EXIT_OK
    assert json.loads(capsys.readouterr().out)["arrivals"] == []


def test_llegadas_empty_table(
    main: Callable[[list[str]], int], upstream: FakeUpstream, capsys: pytest.CaptureFixture[str]
) -> None:
    upstream.serve_arrivals("101", "upstream/arrivals-vacio-101.json")
    assert main(["llegadas", "101"]) == EXIT_OK
    assert "Sin llegadas previstas" in capsys.readouterr().out


def test_unknown_stop_exits_with_error(
    main: Callable[[list[str]], int], upstream: FakeUpstream, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["llegadas", "424242"]) == EXIT_ERROR
    assert "424242" in capsys.readouterr().err


def test_grabar_writes_raw_documents(
    main: Callable[[list[str]], int],
    upstream: FakeUpstream,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    upstream.serve_arrivals("101", "upstream/arrivals-101.json")
    assert main(["grabar", "101", "--salida", str(tmp_path)]) == EXIT_OK
    assert sorted(p.name for p in tmp_path.iterdir()) == [
        "arrivals-101.json",
        "lines.json",
        "stops.json",
    ]
    recorded = json.loads((tmp_path / "arrivals-101.json").read_text(encoding="utf-8"))
    assert recorded == load_fixture("upstream/arrivals-101.json")
    (request,) = upstream.calls("estimatedTimetable/byStop/101")
    assert request.query == {"lines": "7,5,10,2", "previewMinutes": "60"}


def test_horario_table(
    main: Callable[[list[str]], int], upstream: FakeUpstream, capsys: pytest.CaptureFixture[str]
) -> None:
    upstream.reply(
        "productionTimetable/byLine/10", payload=load_fixture("upstream/timetable-10.json")
    )
    assert main(["horario", "10"]) == EXIT_OK
    out = capsys.readouterr().out.splitlines()
    assert out[0] == "Línea 10 · horario de hoy (2026-10-03)"
    assert out[1] == "  Hacia Artesanos (salidas de Manuel de Falla): 07:15–22:45"
    assert "    15:35–15:45 cada 10 min" in out
    assert out[6].startswith("    07:15 07:45 08:15")


def test_horario_json_and_no_service(
    main: Callable[[list[str]], int], upstream: FakeUpstream, capsys: pytest.CaptureFixture[str]
) -> None:
    empty = {"result": {"frequenciesByDirection": {}, "passesByDirection": {}}}
    upstream.reply("productionTimetable/byLine/2", payload=empty)
    assert main(["--json", "horario", "2"]) == EXIT_OK
    assert json.loads(capsys.readouterr().out)["directions"] == []
    upstream.reply("productionTimetable/byLine/5", payload=empty)
    assert main(["horario", "5"]) == EXIT_OK
    assert "Sin servicio hoy" in capsys.readouterr().out
