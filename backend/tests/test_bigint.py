"""大整数（2^53 附近）端到端精度测试。

浏览器 Number 在 |x| > 2^53 时无法区分相邻整数；本服务必须让声明为整数的
target / sigma / readings 在「请求原文 → 规则判定 → 响应原文」保持同一数值身份。

后端 Python 整数任意精度，这些用例同时锁定：
  1. 服务端接受逐位精确的大整数（即便绕过浏览器直接调接口）；
  2. 严格倍数边界不因任何舍入漂移；
  3. 响应 wire 文本逐位输出，不能被中间环节改成双精度近似值。
"""
from __future__ import annotations

import json

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

P53 = 2**53
P53_P1 = 2**53 + 1
P53_P2 = 2**53 + 2
N53 = -(2**53)
N53_M1 = -(2**53) - 1
N53_M2 = -(2**53) - 2


def _raw(payload_text: str):
    return client.post(
        "/api/evaluate",
        content=payload_text,
        headers={"Content-Type": "application/json"},
    )


def test_positive_target_boundary_stable_then_violates_r1():
    # target = 2^53+1，读数恰为 target+3σ 边界：稳定（等于不算越过）
    boundary = {"target": P53_P1, "sigma": 1, "readings": [P53_P1 + 3, P53_P1]}
    r = client.post("/api/evaluate", json=boundary)
    assert r.status_code == 200
    body = r.json()
    assert body["stable"] is True
    assert body["points"][0]["zone"] == "A_plus"

    # target+3σ+1：严格越过 → R1，证据读数逐位保持
    over = {"target": P53_P1, "sigma": 1, "readings": [P53_P1, P53_P1 + 4]}
    r = client.post("/api/evaluate", json=over)
    assert r.status_code == 200
    v = r.json()["violation"]
    assert (v["rule_id"], v["side"], v["end_index"]) == ("R1", "above", 1)
    assert v["evidence"][0]["value"] == P53_P1 + 4
    assert v["evidence"][0]["deviation"] == 4


def test_negative_target_boundary_stable_then_violates_r1():
    # target = -(2^53+1)
    boundary = {"target": N53_M1, "sigma": 1, "readings": [N53_M1 - 3, N53_M1]}
    r = client.post("/api/evaluate", json=boundary)
    assert r.status_code == 200
    assert r.json()["stable"] is True
    assert r.json()["points"][0]["zone"] == "A_minus"

    over = {"target": N53_M1, "sigma": 1, "readings": [N53_M1, N53_M1 - 4]}
    r = client.post("/api/evaluate", json=over)
    assert r.status_code == 200
    v = r.json()["violation"]
    assert (v["rule_id"], v["side"], v["end_index"]) == ("R1", "below", 1)
    assert v["evidence"][0]["value"] == N53_M1 - 4


def test_huge_sigma_strict_multiple_boundary():
    # sigma = 2^53：±1σ / ±2σ / ±3σ 全部精确落在大整数上
    cases = {
        P53 * 3: True,       # 正好 +3σ：不越过
        P53 * 3 + 1: False,  # +1：R1 上侧
        -(P53 * 3): True,    # 正好 -3σ
        -(P53 * 3 + 1): False,
    }
    for reading, stable in cases.items():
        r = client.post(
            "/api/evaluate",
            json={"target": 0, "sigma": P53, "readings": [0, reading]},
        )
        assert r.status_code == 200
        assert r.json()["stable"] is stable, reading
        if not stable:
            v = r.json()["violation"]
            assert v["rule_id"] == "R1"
            assert v["side"] == ("above" if reading > 0 else "below")


def test_huge_target_and_huge_sigma_combined():
    # target 与 sigma 都越过 2^53，控制线仍为精确大整数
    target = P53_P1
    sigma = P53
    on_boundary = target + 2 * sigma   # 正好 +2σ：不算越过
    beyond = target + 2 * sigma + 1    # +2σ+1：严格越过

    # 两个读数严格越过 +2σ，窗口三点中两点 → R2
    r = client.post(
        "/api/evaluate",
        json={"target": target, "sigma": sigma, "readings": [beyond, beyond, target]},
    )
    assert r.status_code == 200
    v = r.json()["violation"]
    assert v["rule_id"] == "R2" and v["side"] == "above" and v["end_index"] == 2
    assert v["evidence_indices"] == [0, 1]

    # 读数只到 +2σ 边界（不越过），且不足八点同侧 → 稳定
    r = client.post(
        "/api/evaluate",
        json={"target": target, "sigma": sigma,
              "readings": [on_boundary, target, on_boundary, target]},
    )
    assert r.status_code == 200
    assert r.json()["stable"] is True


def test_request_wire_literal_parsed_without_rounding():
    # 直接以 wire 文本提交 2^53+1（模拟绕过页面的精确接口调用）
    r = _raw(f'{{"target": {P53_P1}, "sigma": 1, "readings": [{P53_P1}, {P53_P1 + 4}]}}')
    assert r.status_code == 200
    body = json.loads(r.content)
    assert body["target"] == P53_P1
    assert body["points"][1]["value"] == P53_P1 + 4

    # 若 wire 上是被双精度舍入过的值（末位 2 而非 3），服务端应按收到的真实值判定：
    # 2^53+2 距 target 仍为 +1 偏差场景，这里用 target=0 验证相邻整数可被区分
    r_exact = _raw(f'{{"target": 0, "sigma": 1, "readings": [0, {P53_P1}]}}')
    r_rounded = _raw(f'{{"target": 0, "sigma": 1, "readings": [0, {P53_P2}]}}')
    assert json.loads(r_exact.content)["points"][1]["value"] == P53_P1
    assert json.loads(r_rounded.content)["points"][1]["value"] == P53_P2


def test_response_wire_emits_exact_digits_not_double_approx():
    # 响应原文必须逐位包含精确大整数，而不是 9007199254740990 之类双精度近似
    r = client.post(
        "/api/evaluate",
        json={"target": N53_M1, "sigma": 1, "readings": [N53_M1, N53_M2]},
    )
    assert r.status_code == 200
    text = r.text
    for literal in (str(N53_M1), str(N53_M2)):
        assert f': {literal}' in text or f':{literal}' in text or f'[{literal}' in text
    # 控制线 center / lcl_3s 精确
    assert str(N53_M1) in text
    assert str(N53_M1 - 3) in text
    # 逐位解析回来后所有整数字段保持同一数值身份
    body = json.loads(text)
    assert body["target"] == N53_M1
    assert body["limits"]["center"] == N53_M1
    assert body["limits"]["lcl_3s"] == N53_M1 - 3
    assert body["limits"]["ucl_3s"] == N53_M1 + 3
    assert [p["value"] for p in body["points"]] == [N53_M1, N53_M2]
    assert body["points"][1]["deviation"] == N53_M2 - N53_M1
