"""引擎测试：手工边界用例 + 朴素窗口扫描 oracle 随机对拍。"""
from __future__ import annotations

import random

import pytest

from app.engine import build_points, evaluate
from tests.oracle import naive_violation, naive_zone


def _first(target, sigma, readings):
    return evaluate(target, sigma, readings)["violation"]


# ---------- 边界：等于不算越过 ----------

def test_boundary_3sigma_is_stable():
    # ±3σ 边界点不越过，单点不违规
    res = evaluate(10, 2, [16, 4, 10])
    assert res["stable"] is True and res["violation"] is None


def test_beyond_3sigma_strict():
    res = evaluate(10, 2, [17])  # 长度需 >=2，下方补一个中心读数
    res = evaluate(10, 2, [10, 17])
    v = res["violation"]
    assert (v["rule_id"], v["end_index"], v["evidence_indices"], v["side"]) == ("R1", 1, [1], "above")


def test_boundary_2sigma_not_counted_r2():
    # 三点窗口：两个正好 +2σ 不算越过，不能触发 R2
    assert evaluate(10, 2, [14, 14, 10])["stable"] is True


def test_r2_strict_and_evidence():
    # 15 严格越过 +2σ（+4 边界 14 不算）；窗口 [15,15,10] 中两点 → R2
    v = _first(10, 2, [15, 15, 10])
    assert (v["rule_id"], v["end_index"], v["evidence_indices"], v["side"]) == (
        "R2", 2, [0, 1], "above",
    )


def test_r2_sliding_window():
    # 越线点不连续：窗口 [14,10,15] 中两点（下标 0,2）仍构成 R2
    v = _first(10, 2, [15, 10, 15])
    assert (v["rule_id"], v["end_index"], v["evidence_indices"]) == ("R2", 2, [0, 2])


def test_boundary_1sigma_not_counted_r3():
    # 五点中四点正好 +1σ 不算越过
    assert evaluate(10, 2, [12, 12, 12, 12, 10])["stable"] is True


def test_r3_strict_and_evidence():
    v = _first(10, 2, [13, 13, 13, 13, 10])
    assert (v["rule_id"], v["end_index"], v["evidence_indices"], v["side"]) == (
        "R3", 4, [0, 1, 2, 3], "above",
    )


def test_r3_evidence_excludes_inner_point():
    # 五点全在 1σ 外，证据为全部 5 点；越线点 +1 个内侧点的 4 点组合也常见
    v = _first(10, 2, [13, 13, 10, 13, 13])
    assert (v["rule_id"], v["end_index"]) == ("R3", 4)
    assert v["evidence_indices"] == [0, 1, 3, 4]


def test_r4_center_breaks_run():
    # 7 个同侧 + 1 个中心点：不触发 R4
    assert evaluate(0, 1, [1, 1, 1, 1, 1, 1, 1, 0])["stable"] is True


def test_r4_below_side():
    v = _first(0, 5, [-1, -1, -1, -1, -1, -1, -1, -1])
    assert (v["rule_id"], v["end_index"], v["side"]) == ("R4", 7, "below")
    assert v["evidence_indices"] == list(range(8))


def test_r4_eight_above_at_sigma():
    # 全部读数 = target + sigma：不越任何 σ 线，但八点同侧 → R4
    v = _first(10, 1, [11, 11, 11, 11, 11, 11, 11, 11])
    assert (v["rule_id"], v["end_index"]) == ("R4", 7)


# ---------- 多规则命中：结束下标优先，其次规则顺序 ----------

def test_earliest_end_wins_over_rule_order():
    # 下标 1 有 R1（+3σ+1），R4 在 end=7；R1 结束下标更小
    readings = [1, 32, 1, 1, 1, 1, 1, 1]
    v = _first(0, 10, readings)
    assert (v["rule_id"], v["end_index"]) == ("R1", 1)


def test_same_end_rule_order_r1_before_r4():
    # end=7：R1（点 7 = 31）与 R4（八点同侧）同时成立 → R1
    v = _first(0, 10, [1, 1, 1, 1, 1, 1, 1, 31])
    assert (v["rule_id"], v["end_index"]) == ("R1", 7)


def test_same_end_rule_order_r2_before_r4():
    # 八点均 +；点 6,7 严格越 2σ → end=7 同时 R2/R4，取 R2
    v = _first(0, 10, [1, 1, 1, 1, 1, 1, 21, 21])
    assert (v["rule_id"], v["end_index"]) == ("R2", 7)
    assert v["evidence_indices"] == [6, 7]


def test_same_end_rule_order_r2_before_r3():
    # end=4：点3,4 越2σ（窗口3点含2点→R2）；点1..4 中1,3,4 越1σ，
    # 仅 3 点，需 4 点。改为点 1..4 中四点越1σ且点3,4越2σ：
    # 点 1=11, 2=11, 3=21, 4=21，窗口0..4=[10,11,11,21,21]
    # 越1σ 四点 = 1,2,3,4 → R3；R2 仅窗口 2,3,4=[11,21,21] 两点 → end=4
    v = _first(0, 10, [10, 11, 11, 21, 21])
    assert (v["rule_id"], v["end_index"]) == ("R2", 4)
    assert v["evidence_indices"] == [3, 4]


def test_same_end_rule_order_r3_before_r4():
    # 八点同侧；末五点四点严格越1σ（点 4,5,6,7）→ end=7 同时 R3/R4
    v = _first(0, 10, [1, 1, 1, 1, 11, 11, 11, 11])
    assert (v["rule_id"], v["end_index"]) == ("R3", 7)
    assert v["evidence_indices"] == [4, 5, 6, 7]


def test_r2_below_side_and_earlier_end():
    v = _first(0, 10, [-21, -21, 0])
    assert (v["rule_id"], v["side"], v["end_index"]) == ("R2", "below", 2)


def test_no_violation_stable():
    res = evaluate(100, 5, list(range(96, 106)))  # 交替围绕中心
    assert res["stable"] is True


# ---------- 分区 ----------

def test_zone_boundaries_exhaustive():
    sigma = 2
    target = 10
    cases = {
        10: "center",
        11: "C_plus",   # +1σ 边界 → 内侧 C
        12: "C_plus",   # 正好 +1σ
        13: "B_plus",   # 严格越过 1σ
        14: "B_plus",   # 正好 +2σ → 内侧 B
        15: "A_plus",   # 严格越过 2σ
        16: "A_plus",   # 正好 +3σ → 内侧 A（不越线）
        17: "beyond_plus",
        9: "C_minus",
        8: "C_minus",
        7: "B_minus",
        6: "B_minus",
        5: "A_minus",
        4: "A_minus",
        3: "beyond_minus",
    }
    pts = {p["value"]: p for p in build_points(target, sigma, list(cases))}
    for value, zone in cases.items():
        assert pts[value]["zone"] == zone
        assert pts[value]["zone"] == naive_zone(value, target, sigma)


def test_point_flag_consistency():
    target, sigma, readings = 10, 3, [1, 9, 10, 13, 16, 19, 20]
    pts = build_points(target, sigma, readings)
    for p in pts:
        ad = abs(p["deviation"])
        assert p["beyond_1s"] == (ad > sigma)
        assert p["beyond_2s"] == (ad > 2 * sigma)
        assert p["beyond_3s"] == (ad > 3 * sigma)


# ---------- 朴素窗口扫描 oracle 对拍 ----------

@pytest.mark.parametrize("seed", range(300))
def test_vs_naive_oracle_random(seed):
    rng = random.Random(seed)
    target = rng.randint(-50, 50)
    sigma = rng.choice([1, 1, 2, 3, 5, 10])
    n = rng.randint(2, 60)
    # 偏差分布偏向 σ 倍数附近，更容易产生各种规则命中
    readings = [
        target + rng.choice([-4, -3, -3, -2, -2, -1, -1, 0, 0, 1, 1, 2, 2, 3, 3, 4]) * sigma
        + rng.choice([-1, 0, 0, 1])
        for _ in range(n)
    ]
    res = evaluate(target, sigma, readings)
    oracle = naive_violation(target, sigma, readings)

    if oracle is None:
        assert res["stable"] is True and res["violation"] is None
    else:
        v = res["violation"]
        assert v is not None
        assert v["rule_id"] == oracle["rule_id"]
        assert v["end_index"] == oracle["end_index"]
        assert v["side"] == oracle["side"]
        assert v["evidence_indices"] == oracle["evidence_indices"]
        # 证据点确实满足对应规则的越线条件
        for i in v["evidence_indices"]:
            d = readings[i] - target
            if v["rule_id"] == "R1":
                assert abs(d) > 3 * sigma
            elif v["rule_id"] == "R2":
                assert d > 2 * sigma if v["side"] == "above" else d < -2 * sigma
            elif v["rule_id"] == "R3":
                assert d > sigma if v["side"] == "above" else d < -sigma
            else:
                assert d > 0 if v["side"] == "above" else d < 0

    # 每个点的分区都与 oracle 一致
    for p, raw in zip(res["points"], readings):
        assert p["zone"] == naive_zone(raw, target, sigma)


def test_vs_naive_oracle_all_same_side_runs():
    # 极端形态：全部同侧小偏差，R4 随长度逐步出现
    for n in range(2, 30):
        readings = [1] * n
        res = evaluate(0, 10, readings)
        oracle = naive_violation(0, 10, readings)
        if n >= 8:
            assert res["violation"]["rule_id"] == "R4"
            assert res["violation"]["end_index"] == 7
        else:
            assert res["stable"] is True
        assert (res["violation"] is None) == (oracle is None)
