"""API 测试：200 正常路径、422 输入校验、响应结构契约。"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    assert client.get("/health").json() == {"status": "ok"}


def test_stable_response_shape():
    r = client.post("/api/evaluate", json={"target": 10, "sigma": 2, "readings": [10, 11, 9]})
    assert r.status_code == 200
    body = r.json()
    assert body["stable"] is True
    assert body["violation"] is None
    assert body["target"] == 10 and body["sigma"] == 2
    assert body["limits"] == {
        "center": 10,
        "ucl_3s": 16,
        "lcl_3s": 4,
        "upper_2s": 14,
        "lower_2s": 6,
        "upper_1s": 12,
        "lower_1s": 8,
    }
    assert [p["index"] for p in body["points"]] == [0, 1, 2]
    assert [p["value"] for p in body["points"]] == [10, 11, 9]
    assert [p["zone"] for p in body["points"]] == ["center", "C_plus", "C_minus"]


def test_violation_response_contains_evidence_and_zones():
    r = client.post("/api/evaluate", json={"target": 0, "sigma": 10, "readings": [1, 1, 1, 1, 1, 1, 21, 21]})
    assert r.status_code == 200
    v = r.json()["violation"]
    assert v["rule_id"] == "R2"
    assert v["side"] == "above"
    assert v["threshold"] == "2sigma"
    assert v["end_index"] == 7
    assert v["evidence_indices"] == [6, 7]
    assert [p["index"] for p in v["evidence"]] == [6, 7]
    assert all(p["zone"] == "A_plus" for p in v["evidence"])
    # 表格与 SVG 共用点序列：每点均带分区
    zones = {p["index"]: p["zone"] for p in r.json()["points"]}
    assert zones[0] == "C_plus" and zones[7] == "A_plus"


def test_negative_target_allowed():
    r = client.post("/api/evaluate", json={"target": -50, "sigma": 1, "readings": [-46, -46]})
    assert r.status_code == 200
    assert r.json()["violation"]["rule_id"] == "R1"


def test_readings_length_boundaries_accepted():
    for n in (2, 200):
        r = client.post("/api/evaluate", json={"target": 0, "sigma": 1, "readings": [0] * n})
        assert r.status_code == 200


@pytest.mark.parametrize(
    "payload",
    [
        {"sigma": 1, "readings": [0, 0]},            # 缺 target
        {"target": 0, "readings": [0, 0]},            # 缺 sigma
        {"target": 0, "sigma": 1},                    # 缺 readings
        {"target": 0, "sigma": 0, "readings": [0, 0]},  # sigma 非正
        {"target": 0, "sigma": -1, "readings": [0, 0]},
        {"target": 0, "sigma": 1, "readings": [0]},     # 少于 2 点
        {"target": 0, "sigma": 1, "readings": [0] * 201},  # 超过 200 点
        {"target": 0.5, "sigma": 1, "readings": [0, 0]},   # target 非整数
        {"target": 0, "sigma": 1.0, "readings": [0, 0]},   # 1.0 也不是严格整数
        {"target": True, "sigma": 1, "readings": [0, 0]},  # 布尔不接受
        {"target": 0, "sigma": 1, "readings": [0, "1"]},   # 读数非整数
        {"target": 0, "sigma": 1, "readings": [None, 0]},
        {"target": 0, "sigma": 1, "readings": [0, 0], "extra": 1},  # 未知字段
        {"target": "0", "sigma": 1, "readings": [0, 0]},
    ],
)
def test_invalid_payloads_return_422(payload):
    r = client.post("/api/evaluate", json=payload)
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert isinstance(detail, list) and detail


def test_reading_values_not_range_limited():
    # 读数本身没有上下限，大整数也必须接受（仅做精确整数比较）
    r = client.post(
        "/api/evaluate",
        json={"target": 0, "sigma": 1, "readings": [10**18, -(10**18)]},
    )
    assert r.status_code == 200
    assert r.json()["violation"]["rule_id"] == "R1"
