from fastapi.testclient import TestClient

from app.main import app

from .conftest import fixture_text

client = TestClient(app)


def _create(name: str) -> str:
    """Upload + parse only (no rules run yet); returns the analysis id."""
    resp = client.post(
        "/analyses",
        files={"file": (name, fixture_text(name), "application/x-yaml")},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["analysis_id"]


def _analyze(analysis_id: str, payload: dict | None = None) -> dict:
    """Run the analysis stage; empty payload analyses the stored graph as-is."""
    resp = client.post(f"/analyses/{analysis_id}/analyze", json=payload)
    assert resp.status_code == 200, resp.text
    return resp.json()


def _create_analyzed(name: str) -> str:
    """Parse then analyze the stored graph, so findings exist."""
    analysis_id = _create(name)
    _analyze(analysis_id)
    return analysis_id


def test_health():
    assert client.get("/health").json()["status"] == "ok"


def test_create_parses_without_running_rules():
    resp = client.post(
        "/analyses",
        files={"file": ("hiresmart_generic.yaml", fixture_text("hiresmart_generic.yaml"), "application/x-yaml")},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # Parse stage: the graph is built but no rules have run yet.
    assert body["status"] == "parsed"
    summary = body["summary"]
    assert summary["nodes"] == 7 and summary["edges"] == 6
    assert summary["findings"] == 0 and summary["critical"] == 0 and summary["max_score"] == 0


def test_analyze_stage_produces_findings():
    analysis_id = _create("hiresmart_generic.yaml")
    body = _analyze(analysis_id)
    assert body["status"] == "completed"
    summary = body["summary"]
    assert summary["nodes"] == 7 and summary["edges"] == 6
    assert summary["critical"] >= 1
    assert summary["max_score"] > 0
    assert {"nodes", "edges"} <= body["graph"].keys()
    assert body["findings"]


def test_submitted_name_overrides_yaml_and_is_echoed():
    resp = client.post(
        "/analyses",
        files={"file": ("hiresmart_generic.yaml", fixture_text("hiresmart_generic.yaml"), "application/x-yaml")},
        data={"name": "My Custom Audit Name"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["name"] == "My Custom Audit Name"


def test_name_falls_back_to_yaml_metadata():
    resp = client.post(
        "/analyses",
        files={"file": ("hiresmart_generic.yaml", fixture_text("hiresmart_generic.yaml"), "application/x-yaml")},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["name"] == "HireSmart Copilot"


def test_graph_endpoint_frontend_shape():
    analysis_id = _create("hiresmart_generic.yaml")
    graph = client.get(f"/analyses/{analysis_id}/graph").json()
    assert {"nodes", "edges"} <= graph.keys()
    node = next(n for n in graph["nodes"] if n["id"] == "input_web_form")
    assert "untrusted" in node["badges"]
    assert all({"risk_level", "blocked", "finding_ids"} <= e.keys() for e in graph["edges"])
    assert all({"risk_level", "finding_ids"} <= n.keys() for n in graph["nodes"])


def test_graph_nodes_carry_node_scoped_findings():
    # Node-scoped findings have no edges, so they can only be shown on the node
    # itself. Every finding must be listed on each node of its path.
    analysis_id = _create_analyzed("hiresmart_generic.yaml")
    findings = client.get(f"/analyses/{analysis_id}/findings").json()["findings"]
    graph = client.get(f"/analyses/{analysis_id}/graph").json()
    nodes = {n["id"]: n for n in graph["nodes"]}

    edgeless = [f for f in findings if not f["edges"]]
    assert edgeless, "fixture should produce at least one node-scoped finding"
    for finding in findings:
        for node_id in finding["path"]:
            assert finding["id"] in nodes[node_id]["finding_ids"]
    # A node's risk_level is the highest severity among its findings.
    rank = ["info", "low", "medium", "high", "critical"]
    for node in nodes.values():
        expected = max(
            (f["severity"] for f in findings if f["id"] in node["finding_ids"]),
            key=rank.index,
            default="info",
        )
        assert node["risk_level"] == expected


def test_findings_endpoint_sorted_and_detail():
    analysis_id = _create_analyzed("hiresmart_generic.yaml")
    findings = client.get(f"/analyses/{analysis_id}/findings").json()["findings"]
    assert findings
    scores = [f["score"] for f in findings]
    assert scores == sorted(scores, reverse=True)

    finding_id = findings[0]["id"]
    detail = client.get(f"/analyses/{analysis_id}/findings/{finding_id}").json()
    assert detail["finding"]["id"] == finding_id
    assert {"nodes", "edges"} <= detail["path_graph"].keys()


def test_list_analyses_includes_created_and_is_newest_first():
    first = _create("hiresmart_generic.yaml")
    second = _create_analyzed("hiresmart_generic.yaml")

    body = client.get("/analyses").json()
    assert "analyses" in body
    by_id = {a["analysis_id"]: a for a in body["analyses"]}
    assert {first, second} <= by_id.keys()

    # Each item carries enough for a list view without a per-analysis fetch.
    item = by_id[second]
    assert item["name"] and item["source_framework"] and item["uploaded_at"]
    assert {"nodes", "edges", "findings"} <= item["summary"].keys()
    # The analyzed one has findings; the parse-only one does not.
    assert by_id[second]["summary"]["findings"] > 0
    assert by_id[first]["summary"]["findings"] == 0

    # Newest upload first (descending uploaded_at).
    timestamps = [a["uploaded_at"] for a in body["analyses"]]
    assert timestamps == sorted(timestamps, reverse=True)


def test_get_analysis_returns_same_shape_as_its_listing_row():
    analysis_id = _create_analyzed("hiresmart_generic.yaml")

    detail = client.get(f"/analyses/{analysis_id}")
    assert detail.status_code == 200, detail.text

    row = next(a for a in client.get("/analyses").json()["analyses"] if a["analysis_id"] == analysis_id)
    # The detail endpoint exists so the UI can skip fetching the whole list.
    assert detail.json() == row


def test_get_unknown_analysis_returns_error_envelope():
    resp = client.get("/analyses/does-not-exist")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "ANALYSIS_NOT_FOUND"


def test_rename_updates_the_detail_and_the_listing():
    analysis_id = _create_analyzed("hiresmart_generic.yaml")

    resp = client.patch(f"/analyses/{analysis_id}", json={"name": "  Renamed test  "})
    assert resp.status_code == 200, resp.text
    # Same shape as GET /analyses/{id}, with the trimmed name.
    assert resp.json()["name"] == "Renamed test"
    assert resp.json() == client.get(f"/analyses/{analysis_id}").json()

    row = next(a for a in client.get("/analyses").json()["analyses"] if a["analysis_id"] == analysis_id)
    assert row["name"] == "Renamed test"


def test_rename_persists_to_disk_and_survives_a_reanalysis():
    from app.core.storage.repository import AnalysisRepository, repository

    analysis_id = _create("hiresmart_generic.yaml")
    assert client.patch(f"/analyses/{analysis_id}", json={"name": "Renamed"}).status_code == 200

    # A fresh repository has an empty cache, so this reads the file on disk.
    assert AnalysisRepository(repository.data_dir).get(analysis_id).ir.metadata.name == "Renamed"
    # Running the rules again keeps the stored name.
    assert _analyze(analysis_id)["name"] == "Renamed"


def test_rename_rejects_a_blank_name():
    analysis_id = _create("hiresmart_generic.yaml")
    original = client.get(f"/analyses/{analysis_id}").json()["name"]

    resp = client.patch(f"/analyses/{analysis_id}", json={"name": "   "})
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "INVALID_NAME"
    assert client.get(f"/analyses/{analysis_id}").json()["name"] == original


def test_rename_unknown_analysis_returns_error_envelope():
    resp = client.patch("/analyses/does-not-exist", json={"name": "Renamed"})
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "ANALYSIS_NOT_FOUND"


def test_rename_storage_failure_keeps_the_old_name(monkeypatch):
    from app.core.storage.repository import repository

    analysis_id = _create("hiresmart_generic.yaml")
    original = client.get(f"/analyses/{analysis_id}").json()["name"]
    with monkeypatch.context() as m:
        m.setattr(
            type(repository.data_dir),
            "write_text",
            lambda *a, **k: (_ for _ in ()).throw(OSError("disk full")),
        )
        resp = client.patch(f"/analyses/{analysis_id}", json={"name": "Renamed"})
    assert resp.status_code == 500
    assert resp.json()["error"]["code"] == "STORAGE_ERROR"
    assert client.get(f"/analyses/{analysis_id}").json()["name"] == original


def test_rename_survives_an_analysis_with_an_edited_graph():
    analysis_id = _create("hiresmart_generic.yaml")
    assert client.patch(f"/analyses/{analysis_id}", json={"name": "Renamed"}).status_code == 200

    graph = client.get(f"/analyses/{analysis_id}/graph").json()
    assert _analyze(analysis_id, _analyze_payload(graph))["name"] == "Renamed"
    assert client.get(f"/analyses/{analysis_id}").json()["name"] == "Renamed"


def test_rename_during_an_analysis_is_not_lost(monkeypatch):
    """A rename that arrives while /analyze runs must not be overwritten when
    the analysis saves itself back. The analysis is held mid-run so the rename
    is sent at exactly that point."""
    import threading

    from app.api.routes import analyze as analyze_route

    analysis_id = _create("hiresmart_generic.yaml")
    started, release = threading.Event(), threading.Event()
    real_analyze_stored = analyze_route.analyze_stored

    def held_analyze_stored(stored):
        started.set()
        assert release.wait(timeout=10)
        return real_analyze_stored(stored)

    monkeypatch.setattr(analyze_route, "analyze_stored", held_analyze_stored)

    responses: dict[str, object] = {}
    analyze_thread = threading.Thread(
        target=lambda: responses.update(analyze=client.post(f"/analyses/{analysis_id}/analyze"))
    )
    rename_thread = threading.Thread(
        target=lambda: responses.update(
            rename=client.patch(f"/analyses/{analysis_id}", json={"name": "Renamed mid-analysis"})
        )
    )
    analyze_thread.start()
    assert started.wait(timeout=10)
    rename_thread.start()
    # The rename waits for the analysis instead of saving underneath it.
    rename_thread.join(timeout=0.5)
    assert rename_thread.is_alive()

    release.set()
    analyze_thread.join(timeout=10)
    rename_thread.join(timeout=10)
    assert responses["analyze"].status_code == 200
    assert responses["rename"].status_code == 200
    assert client.get(f"/analyses/{analysis_id}").json()["name"] == "Renamed mid-analysis"


def test_rename_rejects_a_name_over_the_limit_with_the_error_envelope():
    from app.core.ir.models import MAX_NAME_LENGTH

    analysis_id = _create("hiresmart_generic.yaml")
    assert client.patch(f"/analyses/{analysis_id}", json={"name": "x" * MAX_NAME_LENGTH}).status_code == 200

    resp = client.patch(f"/analyses/{analysis_id}", json={"name": "x" * (MAX_NAME_LENGTH + 1)})
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "INVALID_REQUEST"


def test_create_rejects_a_name_over_the_limit_with_the_error_envelope():
    from app.core.ir.models import MAX_NAME_LENGTH

    resp = client.post(
        "/analyses",
        files={"file": ("hiresmart_generic.yaml", fixture_text("hiresmart_generic.yaml"), "application/x-yaml")},
        data={"name": "x" * (MAX_NAME_LENGTH + 1)},
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "INVALID_REQUEST"


def test_malformed_bodies_use_the_error_envelope():
    analysis_id = _create("hiresmart_generic.yaml")
    for body in ({}, {"name": 123}):
        resp = client.patch(f"/analyses/{analysis_id}", json=body)
        assert resp.status_code == 422, body
        error = resp.json()["error"]
        assert error["code"] == "INVALID_REQUEST"
        assert error["details"]["errors"][0]["loc"] == ["body", "name"]


def test_delete_removes_analysis_and_drops_it_from_the_listing():
    analysis_id = _create("hiresmart_generic.yaml")

    resp = client.delete(f"/analyses/{analysis_id}")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"analysis_id": analysis_id, "status": "deleted"}

    # The row is gone from the list and the analysis is no longer readable.
    listed = {a["analysis_id"] for a in client.get("/analyses").json()["analyses"]}
    assert analysis_id not in listed
    assert client.get(f"/analyses/{analysis_id}/graph").status_code == 404


def test_delete_is_not_idempotent_and_404s_on_second_call():
    analysis_id = _create("hiresmart_generic.yaml")
    assert client.delete(f"/analyses/{analysis_id}").status_code == 200

    resp = client.delete(f"/analyses/{analysis_id}")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "ANALYSIS_NOT_FOUND"


def test_delete_unknown_analysis_returns_error_envelope():
    resp = client.delete("/analyses/does-not-exist")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "ANALYSIS_NOT_FOUND"


def test_delete_storage_failure_returns_500(monkeypatch):
    from app.core.storage.repository import repository

    analysis_id = _create("hiresmart_generic.yaml")
    monkeypatch.setattr(
        type(repository.data_dir),
        "unlink",
        lambda *a, **k: (_ for _ in ()).throw(OSError("permission denied")),
    )
    resp = client.delete(f"/analyses/{analysis_id}")
    assert resp.status_code == 500
    assert resp.json()["error"]["code"] == "STORAGE_ERROR"


def test_unknown_analysis_returns_error_envelope():
    resp = client.get("/analyses/does-not-exist/graph")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "ANALYSIS_NOT_FOUND"


def test_empty_upload_rejected():
    resp = client.post("/analyses", files={"file": ("empty.yaml", "", "application/x-yaml")})
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "EMPTY_INPUT"


def test_corrupt_stored_analysis_returns_500():
    from app.core.storage.repository import repository

    (repository.data_dir / "corruptx.json").write_text("{ not valid", encoding="utf-8")
    resp = client.get("/analyses/corruptx/graph")
    assert resp.status_code == 500
    assert resp.json()["error"]["code"] == "CORRUPT_ANALYSIS"


def _analyze_payload(graph: dict) -> dict:
    """Turn a /graph response into an /analyze body (label -> name)."""
    return {
        "nodes": [
            {"id": n["id"], "type": n["type"], "name": n["label"], "properties": n.get("properties", {})}
            for n in graph["nodes"]
        ],
        "edges": [
            {
                "id": e["id"],
                "source": e["source"],
                "target": e["target"],
                "capability": e["capability"],
                "properties": e.get("properties", {}),
            }
            for e in graph["edges"]
        ],
    }


def test_analyze_empty_body_uses_stored_graph():
    # Analysing with no body (first run, no edits) matches submitting the
    # unedited parsed graph: same findings either way.
    analysis_id = _create("hiresmart_generic.yaml")
    from_stored = _analyze(analysis_id)
    graph = client.get(f"/analyses/{analysis_id}/graph").json()
    from_graph = _analyze(analysis_id, _analyze_payload(graph))
    assert {f["rule_id"] for f in from_stored["findings"]} == {f["rule_id"] for f in from_graph["findings"]}
    assert from_stored["summary"]["findings"] == from_graph["summary"]["findings"]


def test_analyze_removing_send_drops_exfiltration_finding():
    analysis_id = _create("hiresmart_generic.yaml")
    graph = client.get(f"/analyses/{analysis_id}/graph").json()
    payload = _analyze_payload(graph)
    # Drop the final send hop to the external email: FH-001 must disappear.
    payload["edges"] = [e for e in payload["edges"] if e["id"] != "edge_006"]

    body = _analyze(analysis_id, payload)
    assert "FH-001" not in {f["rule_id"] for f in body["findings"]}


def test_analyze_adding_execute_code_capability_yields_finding():
    analysis_id = _create("hiresmart_generic.yaml")
    before = {f["rule_id"] for f in _analyze(analysis_id)["findings"]}
    assert "FH-010" not in before

    graph = client.get(f"/analyses/{analysis_id}/graph").json()
    payload = _analyze_payload(graph)
    # A newly added code-execution tool reachable from the untrusted web form.
    # Empty properties -> the normalizer defaults sandbox_enabled to false.
    payload["nodes"].append({"id": "tool_new_exec", "type": "tool", "name": "Shell Runner", "properties": {}})
    payload["edges"].append(
        {
            "id": "edge_new_exec",
            "source": "agent_application_intake",
            "target": "tool_new_exec",
            "capability": "executeCode",
            "properties": {},
        }
    )

    body = _analyze(analysis_id, payload)
    assert "FH-010" in {f["rule_id"] for f in body["findings"]}


def test_analyze_rename_is_reflected_in_graph():
    analysis_id = _create("hiresmart_generic.yaml")
    graph = client.get(f"/analyses/{analysis_id}/graph").json()
    payload = _analyze_payload(graph)
    for node in payload["nodes"]:
        if node["id"] == "agent_application_intake":
            node["name"] = "Renamed Intake"

    body = _analyze(analysis_id, payload)
    renamed = next(n for n in body["graph"]["nodes"] if n["id"] == "agent_application_intake")
    assert renamed["label"] == "Renamed Intake"
    # The rename persists: a subsequent graph read returns the new label.
    graph_after = client.get(f"/analyses/{analysis_id}/graph").json()
    assert next(n for n in graph_after["nodes"] if n["id"] == "agent_application_intake")["label"] == "Renamed Intake"


def test_analyze_preserves_endpoints_of_existing_edge():
    analysis_id = _create("hiresmart_generic.yaml")
    graph = client.get(f"/analyses/{analysis_id}/graph").json()
    payload = _analyze_payload(graph)
    # Tamper with an existing edge's endpoints. They must be ignored in favour of
    # the stored ones (only capability is editable for a known edge id), so a
    # resubmitted id cannot silently rewire the graph.
    for e in payload["edges"]:
        if e["id"] == "edge_006":
            e["source"] = "input_web_form"
            e["target"] = "input_web_form"

    body = _analyze(analysis_id, payload)
    edge = next(e for e in body["graph"]["edges"] if e["id"] == "edge_006")
    assert edge["source"] == "agent_candidate_communicator"
    assert edge["target"] == "output_email_candidate"


def test_analyze_unknown_analysis_returns_404():
    resp = client.post("/analyses/does-not-exist/analyze", json={"nodes": [], "edges": []})
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "ANALYSIS_NOT_FOUND"


def test_analyze_dangling_edge_rejected():
    analysis_id = _create("hiresmart_generic.yaml")
    graph = client.get(f"/analyses/{analysis_id}/graph").json()
    payload = _analyze_payload(graph)
    payload["edges"].append(
        {
            "id": "edge_dangling",
            "source": "agent_application_intake",
            "target": "ghost_node",
            "capability": "send",
            "properties": {},
        }
    )
    resp = client.post(f"/analyses/{analysis_id}/analyze", json=payload)
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "INVALID_IR"


def test_oversized_upload_rejected(monkeypatch):
    from app.api.routes import analyze

    monkeypatch.setattr(analyze, "MAX_UPLOAD_BYTES", 16)
    resp = client.post(
        "/analyses",
        files={"file": ("big.yaml", "x" * 64, "application/x-yaml")},
    )
    assert resp.status_code == 413
    assert resp.json()["error"]["code"] == "UPLOAD_TOO_LARGE"


def test_capabilities_lists_each_verb_with_evaluated_by():
    from app.core.catalogs import capability_catalog

    resp = client.get("/capabilities")
    assert resp.status_code == 200, resp.text
    entries = resp.json()["capabilities"]
    catalog = capability_catalog()
    # Every verb, once, in catalog order, with the catalog's rule list.
    assert [e["verb"] for e in entries] == list(catalog)
    for entry in entries:
        assert entry["evaluated_by"] == catalog[entry["verb"]]["evaluated_by"]
        assert {"description", "typical_source", "typical_target"} <= entry.keys()
    by_verb = {e["verb"]: e for e in entries}
    assert by_verb["executeCode"]["evaluated_by"] == ["FH-010", "FH-016"]
    # Vocabulary-only verbs are listed with an empty list rather than omitted.
    assert by_verb["receiveEvent"]["evaluated_by"] == []
    # The response is typed in OpenAPI, not a bare object.
    schema = client.get("/openapi.json").json()["paths"]["/capabilities"]["get"]["responses"]["200"]
    assert schema["content"]["application/json"]["schema"]["$ref"].endswith("/CapabilitiesResponse")
