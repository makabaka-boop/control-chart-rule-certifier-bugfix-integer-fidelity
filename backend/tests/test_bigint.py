"""大整数（2^53 附近及以上）端到端精度测试。

JavaScript Number 在 2^53 以上无法区分相邻整数：若请求或响应被舍入，
严格的倍数边界（等于不算越过）会漂移，得到另一组越界结论。后端使用
Python 任意精度整数，本文件把这些临界样本钉死，并验证响应文本中
保留逐位一致的十进制证据点与控制线。
"""
from __future__ import annotations

import json

from fastapi.testclient import TestClient

from app.engine import evaluate
from app.main import app

client = TestClient(app)

P53 = 2**53  # 9007199254740992：首个不能与下一个整数区分的 JS Number
P53_P1 = P53 + 1  # 9007199254740993：JS 中会被舍入为 2^53
NEG_P53_M1 = -(2**53) - 1  # -9007199254740993：JS 中会被舍入为 -2^53


def test_engine_target_above_safe_boundary_r2_exact():
    # T = 2^53+1；读数 T−3 恰好严格越过同侧 2σ（d=−3），两点 → R2。
    # 若 target 被舍入为 2^53，偏差会变成 −2（边界不算越过）→ 误判稳定。
    res = evaluate(P53_P1, 1, [P53 - 2, P53 - 2, P53_P1])
    v = res["violation"]
    assert (v["rule_id"], v["side"], v["end_index"]) == ("R2", "below", 2)
    assert v["evidence_indices"] == [0, 1]
    assert [p["zone"] for p in res["points"]] == ["A_minus", "A_minus", "center"]


def test_engine_boundary_3sigma_is_stable_above_safe_boundary():
    # T = 2^53；读数 T−3 正好 −3σ，严格比较下不越线；
    # 舍入后偏差会变成 −4，被错误放行成 R1。
    res = evaluate(P53, 1, [P53, P53 - 3])
    assert res["stable"] is True
    assert res["points"][1]["zone"] == "A_minus"
    assert res["points"][1]["beyond_3s"] is False


def test_engine_negative_target_above_safe_boundary_r2():
    # 负目标：T = −(2^53+1)，读数 T+3 → d=+3，两点 → R2（舍入后 d=+2 稳定）。
    readings = [NEG_P53_M1 + 3, NEG_P53_M1 + 3, NEG_P53_M1]
    res = evaluate(NEG_P53_M1, 1, readings)
    v = res["violation"]
    assert (v["rule_id"], v["side"], v["end_index"]) == ("R2", "above", 2)


def test_engine_r3_with_big_target_scale():
    # T=2^53+1，sigma=2：四个 d=+3（严格越 1σ，+2 是边界不算）→ R3。
    # target 被舍入为 2^53 后 d 变成 +2（=1σ 边界），四点都不计数 → 误判稳定。
    readings = [P53_P1 + 3] * 4 + [P53_P1]
    res = evaluate(P53_P1, 2, readings)
    v = res["violation"]
    assert (v["rule_id"], v["end_index"]) == ("R3", 4)
    assert v["evidence_indices"] == [0, 1, 2, 3]
    assert all(p["zone"] == "B_plus" for p in res["points"][:4])


def test_engine_r4_with_big_target_runs_same_side():
    # 八点全部 d=+1：仅触发 R4；舍入后 d=0（中心点）→ 误判稳定。
    readings = [P53_P1 + 1] * 8
    res = evaluate(P53_P1, 1, readings)
    v = res["violation"]
    assert (v["rule_id"], v["side"], v["end_index"]) == ("R4", "above", 7)
    assert all(p["side"] == "above" for p in res["points"])


def test_engine_huge_sigma_exact_boundaries():
    sigma = P53  # 2^53
    exact_3s = 3 * sigma  # 27021597764222976
    # 恰好 3σ 边界：不越线
    assert evaluate(0, sigma, [0, exact_3s])["stable"] is True
    # 超过 1：R1
    res = evaluate(0, sigma, [0, exact_3s + 1])
    assert res["violation"]["rule_id"] == "R1"
    assert res["violation"]["evidence_indices"] == [1]
    assert res["limits"]["ucl_3s"] == exact_3s


def test_engine_very_large_reading_accepted():
    # 读数本身无数值上下限：10^40 仍按精确整数判定
    big = 10**40
    res = evaluate(0, 1, [big, -big])
    assert res["violation"]["rule_id"] == "R1"
    assert res["points"][0]["value"] == big
    assert res["points"][1]["deviation"] == -big


def test_api_roundtrips_exact_decimal_evidence_and_limits():
    payload = {
        "target": P53_P1,
        "sigma": 1,
        "readings": [P53 - 2, P53 - 2, P53_P1],
    }
    r = client.post("/api/evaluate", json=payload)
    assert r.status_code == 200
    # 响应文本必须逐位保留临界整数（不能出现 9007199254740992 形式的舍入）
    text = r.text
    assert '"target":9007199254740993' in text
    assert '"value":9007199254740990' in text  # 2^53 − 2
    assert '"lower_2s":9007199254740991' in text  # 2^53 − 1（MAX_SAFE_INTEGER）
    assert '"lcl_3s":9007199254740990' in text
    body = json.loads(text)
    v = body["violation"]
    assert (v["rule_id"], v["end_index"], v["evidence_indices"]) == ("R2", 2, [0, 1])
    assert [p["value"] for p in v["evidence"]] == [P53 - 2, P53 - 2]
    # 每点偏差也是精确值
    assert [p["deviation"] for p in body["points"]] == [-3, -3, 0]


def test_api_negative_target_roundtrips_exact_decimal():
    r = client.post(
        "/api/evaluate",
        json={
            "target": NEG_P53_M1,
            "sigma": 1,
            "readings": [NEG_P53_M1 + 3, NEG_P53_M1 + 3, NEG_P53_M1],
        },
    )
    assert r.status_code == 200
    assert r.json()["violation"]["rule_id"] == "R2"
    assert '"target":-9007199254740993' in r.text


def test_api_huge_sigma_and_reading_roundtrip():
    sigma = P53
    beyond = 3 * sigma + 1
    r = client.post(
        "/api/evaluate",
        json={"target": 0, "sigma": sigma, "readings": [0, beyond]},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["violation"]["rule_id"] == "R1"
    assert body["limits"]["ucl_3s"] == 3 * sigma
    assert f'"value":{beyond}' in r.text
