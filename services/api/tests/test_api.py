"""HTTP API end to end: app + aiohttp + fake upstream, compared with the golden corpus."""

from __future__ import annotations

import time
from collections.abc import Callable
from pathlib import Path

import pytest
from contract_fixtures import load_fixture
from fake_upstream import FakeUpstream
from fastapi.testclient import TestClient

from logrono_bus_api.main import API_PREFIX
from logrono_bus_api.problems import PROBLEM_BASE_URI, PROBLEM_CONTENT_TYPE

type ClientFactory = Callable[..., TestClient]

ARRIVALS_101 = "estimatedTimetable/byStop/101"


def _problem_type(response_json: dict[str, object]) -> str:
    return str(response_json["type"]).removeprefix(PROBLEM_BASE_URI)


def test_catalog_matches_golden_except_fetch_time(client: TestClient) -> None:
    response = client.get(f"{API_PREFIX}/catalog")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "public, max-age=3600"
    body = response.json()
    expected = load_fixture("expected/catalog.json")
    body.pop("fetched_at")
    expected.pop("fetched_at")
    assert body == expected


def test_lines_and_line_detail(client: TestClient) -> None:
    labels = [line["label"] for line in client.get(f"{API_PREFIX}/lines").json()]
    assert labels == ["1", "2", "5", "7", "9", "10", "B1", "B3"]

    detail = client.get(f"{API_PREFIX}/lines/31").json()
    assert detail["line"]["label"] == "B1"
    assert [p["headsign"] for p in detail["patterns"]] == ["La Cava", "Artesanos"]

    missing = client.get(f"{API_PREFIX}/lines/8")
    assert missing.status_code == 404
    assert missing.headers["content-type"] == PROBLEM_CONTENT_TYPE
    assert _problem_type(missing.json()) == "linea-no-encontrada"


def test_stop_search_nearby_and_detail(client: TestClient) -> None:
    found = client.get(f"{API_PREFIX}/stops", params={"q": "zubia"}).json()
    assert [stop["id"] for stop in found] == ["28", "803"]
    assert len(client.get(f"{API_PREFIX}/stops").json()) == 77

    nearby = client.get(
        f"{API_PREFIX}/stops/nearby", params={"lat": 42.4655, "lon": -2.4390, "radius_m": 60}
    ).json()
    assert [n["stop"]["id"] for n in nearby] == ["101", "100"]
    assert nearby[0]["distance_m"] < nearby[1]["distance_m"]

    detail = client.get(f"{API_PREFIX}/stops/101").json()
    assert detail["stop"]["name"] == "Ayuntamiento"
    assert [p["id"] for p in detail["patterns"]] == ["2:desc", "5:asc", "7:desc", "10:desc"]


@pytest.mark.parametrize(
    ("params", "field"),
    [
        ({"lat": 91, "lon": 0}, "lat"),
        ({"lat": 42, "lon": 0, "radius_m": 0}, "radius_m"),
        ({"lat": 42}, "lon"),
    ],
)
def test_invalid_query_is_a_problem(
    client: TestClient, params: dict[str, float], field: str
) -> None:
    response = client.get(f"{API_PREFIX}/stops/nearby", params=params)
    assert response.status_code == 422
    body = response.json()
    assert _problem_type(body) == "peticion-no-valida"
    assert any(field in error["loc"] for error in body["errors"])


@pytest.mark.usefixtures("frozen_time")
def test_arrivals_match_golden(client: TestClient, upstream: FakeUpstream) -> None:
    upstream.serve_arrivals("101", "upstream/arrivals-101.json")
    response = client.get(f"{API_PREFIX}/stops/101/arrivals")
    assert response.status_code == 200
    expected = load_fixture("expected/arrivals-ayuntamiento-101.json")
    assert response.json()["arrivals"] == expected["arrivals"]
    assert response.headers["x-cache"] == "miss"
    assert response.headers["x-request-id"]


@pytest.mark.usefixtures("frozen_time")
def test_arrivals_filter_and_shared_cache(client: TestClient, upstream: FakeUpstream) -> None:
    upstream.serve_arrivals("101", "upstream/arrivals-101.json")
    filtered = client.get(f"{API_PREFIX}/stops/101/arrivals", params={"lines": "2d"})
    assert {(a["line_id"], a["direction"]) for a in filtered.json()["arrivals"]} == {("2", "desc")}

    again = client.get(f"{API_PREFIX}/stops/101/arrivals", params={"lines": "10x"})
    assert again.headers["x-cache"] == "hit"
    assert {a["line_id"] for a in again.json()["arrivals"]} == {"10"}
    assert len(upstream.calls(ARRIVALS_101)) == 1


def test_arrivals_errors(client: TestClient, upstream: FakeUpstream) -> None:
    assert _problem_type(client.get(f"{API_PREFIX}/stops/999/arrivals").json()) == (
        "parada-no-encontrada"
    )
    bad = client.get(f"{API_PREFIX}/stops/101/arrivals", params={"lines": "2q"})
    assert bad.status_code == 400
    assert _problem_type(bad.json()) == "seleccion-no-valida"
    assert "2q" in bad.json()["detail"]
    assert not upstream.calls(ARRIVALS_101)


def test_upstream_down_without_cache_is_503_with_retry_after(
    client: TestClient, upstream: FakeUpstream
) -> None:
    upstream.reply_only(ARRIVALS_101, status=503, payload={})
    response = client.get(f"{API_PREFIX}/stops/101/arrivals")
    assert response.status_code == 503
    assert response.headers["retry-after"] == "30"
    assert _problem_type(response.json()) == "origen-no-disponible"


def test_upstream_schema_change_is_502(client: TestClient, upstream: FakeUpstream) -> None:
    upstream.reply_only(ARRIVALS_101, payload={"result": {"llegadas": []}})
    response = client.get(f"{API_PREFIX}/stops/101/arrivals")
    assert response.status_code == 502
    assert _problem_type(response.json()) == "origen-cambiado"
    assert "$.result.arrivals" in response.json()["detail"]


def test_stale_arrivals_served_when_upstream_fails(
    make_client: ClientFactory, upstream: FakeUpstream
) -> None:
    client = make_client(arrivals_ttl_s=1, arrivals_stale_s=600)
    upstream.serve_arrivals("101", "upstream/arrivals-101.json")
    first = client.get(f"{API_PREFIX}/stops/101/arrivals")
    assert first.headers["x-cache"] == "miss"

    upstream.reply_only(ARRIVALS_101, status=500, payload={})
    time.sleep(1.1)  # past the 1 s TTL (the minimum the settings allow)
    stale = client.get(f"{API_PREFIX}/stops/101/arrivals")
    assert stale.status_code == 200
    assert stale.headers["x-cache"] == "stale"
    assert stale.json() == first.json()


def test_circuit_breaker_stops_calling_upstream(
    make_client: ClientFactory, upstream: FakeUpstream
) -> None:
    client = make_client(breaker_failures=2, breaker_reset_s=60)
    upstream.reply_only(ARRIVALS_101, status=502, payload={})
    for _ in range(2):
        assert client.get(f"{API_PREFIX}/stops/101/arrivals").status_code == 503
    opened = client.get(f"{API_PREFIX}/stops/101/arrivals")
    assert opened.status_code == 503
    assert "en pausa" in opened.json()["detail"]
    assert 1 <= int(opened.headers["retry-after"]) <= 60
    assert len(upstream.calls(ARRIVALS_101)) == 2

    health = client.get(f"{API_PREFIX}/health").json()
    assert health["status"] == "degraded"
    assert health["upstream"]["circuit"] == "open"


@pytest.mark.usefixtures("frozen_time")
def test_board_json_matches_card_goldens(client: TestClient, upstream: FakeUpstream) -> None:
    upstream.serve_arrivals("101", "upstream/arrivals-101.json")
    response = client.get(f"{API_PREFIX}/board", params={"p": "101-10x.2d.7d", "limit": 2})
    assert response.status_code == 200
    body = response.json()
    assert body["stale"] is False
    assert body["generated_at"] == "2026-10-03T16:00:45+00:00"
    assert body["cards"] == load_fixture("expected/cards-101-seleccion.json")


@pytest.mark.usefixtures("frozen_time")
@pytest.mark.parametrize(
    ("tiempo", "expected"),
    [
        (
            None,
            [
                "2 → Manresa · Ayuntamiento: 1, 7 min",
                "7 → Enrique Granados · Ayuntamiento: sin llegadas",
                "2 → Artesanos · Ayuntamiento: 10, 20 min",
            ],
        ),
        (
            "hora",
            [
                "2 → Manresa · Ayuntamiento: 18:02, 18:08",
                "7 → Enrique Granados · Ayuntamiento: sin llegadas",
                "2 → Artesanos · Ayuntamiento: 18:10, 18:20",
            ],
        ),
    ],
    ids=["minutos", "hora"],
)
def test_board_text_for_widgets(
    client: TestClient, upstream: FakeUpstream, tiempo: str | None, expected: list[str]
) -> None:
    upstream.serve_arrivals("101", "upstream/arrivals-101.json")
    upstream.serve_arrivals("100", "upstream/arrivals-100.json")
    params = {"p": "101-2d.7d~100-2a", "format": "text", "limit": "2"}
    if tiempo:
        params["tiempo"] = tiempo
    response = client.get(f"{API_PREFIX}/board", params=params)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/plain")
    assert response.text.splitlines() == expected, response.text


def test_board_validates_every_stop_before_fetching(
    client: TestClient, upstream: FakeUpstream
) -> None:
    response = client.get(f"{API_PREFIX}/board", params={"p": "101~424242"})
    assert response.status_code == 404
    assert not upstream.calls(ARRIVALS_101)
    assert client.get(f"{API_PREFIX}/board").status_code == 422


def test_health_livez_readyz_metrics(client: TestClient, upstream: FakeUpstream) -> None:
    assert client.get("/livez").json() == {"status": "ok"}
    assert client.get("/readyz").status_code == 200
    health = client.get(f"{API_PREFIX}/health").json()
    assert health["status"] == "ok"
    assert health["api_version"] == 1
    assert health["upstream"]["circuit"] == "closed"

    upstream.serve_arrivals("101", "upstream/arrivals-101.json")
    client.get(f"{API_PREFIX}/stops/101/arrivals")
    metrics = client.get("/metrics").text
    assert (
        'logrono_bus_upstream_requests_total{endpoint="estimatedTimetable",outcome="ok"} 1.0'
        in metrics
    )
    assert 'logrono_bus_cache_results_total{result="miss"} 1.0' in metrics
    assert 'route="/stops/{stop_id}/arrivals",status="200"' in metrics


def test_readyz_and_health_when_catalog_unreachable(
    make_client: ClientFactory, upstream: FakeUpstream
) -> None:
    upstream.reply_only("linesDiscovery/lines", status=503, payload={})
    client = make_client()
    readiness = client.get("/readyz")
    assert readiness.status_code == 503
    assert readiness.json()["status"] == "unavailable"
    health = client.get(f"{API_PREFIX}/health").json()
    assert health["status"] == "degraded"
    assert health["upstream"]["catalog_fetched_at"] is None


def test_request_id_is_propagated_and_cors_allows_get(client: TestClient) -> None:
    response = client.get(
        f"{API_PREFIX}/lines", headers={"X-Request-ID": "pantalla-cocina", "Origin": "https://x.y"}
    )
    assert response.headers["x-request-id"] == "pantalla-cocina"
    assert response.headers["access-control-allow-origin"] == "*"


def test_unexpected_errors_are_problems(make_client: ClientFactory) -> None:
    client = make_client()

    async def explode() -> None:
        raise RuntimeError("boom")

    client.app.state.service.catalog = explode  # type: ignore[attr-defined]
    response = client.get(f"{API_PREFIX}/lines")
    assert response.status_code == 500
    assert _problem_type(response.json()) == "error-interno"


def test_serves_web_bundle_when_configured(make_client: ClientFactory, tmp_path: Path) -> None:
    (tmp_path / "index.html").write_text("<!doctype html><title>Logroño Bus</title>", "utf-8")
    client = make_client(web_dir=tmp_path)
    assert "Logroño Bus" in client.get("/").text
    assert client.get(f"{API_PREFIX}/lines").status_code == 200


@pytest.mark.usefixtures("frozen_time")
def test_board_order(client: TestClient, upstream: FakeUpstream) -> None:
    upstream.serve_arrivals("101", "upstream/arrivals-101.json")
    soonest = client.get(
        f"{API_PREFIX}/board", params={"p": "101-7d.10d.5a.2d", "orden": "llegada"}
    )
    assert [c["line_label"] for c in soonest.json()["cards"]] == ["2", "10", "5", "7"]
    by_line = client.get(f"{API_PREFIX}/board", params={"p": "101-7d.10d.5a.2d", "orden": "linea"})
    assert [c["line_label"] for c in by_line.json()["cards"]] == ["2", "5", "7", "10"]
    as_chosen = client.get(f"{API_PREFIX}/board", params={"p": "101-7d.10d.5a.2d"})
    assert [c["line_label"] for c in as_chosen.json()["cards"]] == ["7", "10", "5", "2"]
    assert (
        client.get(f"{API_PREFIX}/board", params={"p": "101", "orden": "azar"}).status_code == 422
    )


@pytest.mark.usefixtures("frozen_time")
def test_line_vehicles(client: TestClient, upstream: FakeUpstream) -> None:
    upstream.reply("vehicleMonitoring/byLine/10", payload=load_fixture("upstream/vehicles-10.json"))
    response = client.get(f"{API_PREFIX}/lines/10/vehicles")
    assert response.status_code == 200
    assert response.headers["x-cache"] == "miss"
    # Recorded at 20:30:36 UTC; the frozen clock is 16:00:45, so nothing counts as stale yet.
    assert [v["pattern_id"] for v in response.json()["vehicles"]] == [
        "10:desc",
        "10:desc",
        "10:asc",
        "10:desc",
        "10:asc",
    ]
    assert client.get(f"{API_PREFIX}/lines/10/vehicles").headers["x-cache"] == "hit"
    assert len(upstream.calls("vehicleMonitoring/byLine/10")) == 1
    assert client.get(f"{API_PREFIX}/lines/8/vehicles").status_code == 404


def test_line_timetable(client: TestClient, upstream: FakeUpstream) -> None:
    upstream.reply(
        "productionTimetable/byLine/10", payload=load_fixture("upstream/timetable-10.json")
    )
    response = client.get(f"{API_PREFIX}/lines/10/timetable")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "public, max-age=3600"
    body = response.json()
    assert [(d["pattern_id"], d["origin"], d["departures"][0]) for d in body["directions"]] == [
        ("10:asc", "Manuel de Falla", "07:15"),
        ("10:desc", "Artesanos", "08:00"),
    ]
    # Once per day: the second client is served without asking the Ayuntamiento again.
    assert client.get(f"{API_PREFIX}/lines/10/timetable").status_code == 200
    assert len(upstream.calls("productionTimetable/byLine/10")) == 1


def test_line_timetable_unknown_line(client: TestClient, upstream: FakeUpstream) -> None:
    response = client.get(f"{API_PREFIX}/lines/99/timetable")
    assert response.status_code == 404
    assert response.json()["type"].endswith("#linea-no-encontrada")
