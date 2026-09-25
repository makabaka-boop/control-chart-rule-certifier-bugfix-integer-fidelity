"""控制图规则判定引擎（纯函数，全部使用精确整数比较）。

四条规则（等于边界不算越过）：
  R1  一点严格越过 3σ
  R2  连续三点中至少两点严格越过同侧 2σ
  R3  连续五点中至少四点严格越过同侧 1σ
  R4  连续八点严格位于中心线同侧

命中多个规则时的排序：先取结束下标最小者，再按规则编号顺序，
最后取证据下标序列字典序最小者。
"""
from __future__ import annotations

from typing import Any

RULE_ORDER = ("R1", "R2", "R3", "R4")

RULE_NAMES = {
    "R1": "一点严格越过3σ",
    "R2": "连续三点中至少两点严格越过同侧2σ",
    "R3": "连续五点中至少四点严格越过同侧1σ",
    "R4": "连续八点严格位于中心线同侧",
}

# 分区代码：beyond 为严格越过 3σ；A/B/C 分别为 2σ~3σ、1σ~2σ、中心线~1σ
_ZONE_ABOVE = {3: "beyond_plus", 2: "A_plus", 1: "B_plus", 0: "C_plus"}
_ZONE_BELOW = {3: "beyond_minus", 2: "A_minus", 1: "B_minus", 0: "C_minus"}


def _zone(d: int, sigma: int) -> str:
    """按严格大于判断越过几道 σ 线，边界值归入内侧分区。"""
    if d > 0:
        ad = d
        level = 3 if ad > 3 * sigma else 2 if ad > 2 * sigma else 1 if ad > sigma else 0
        return _ZONE_ABOVE[level]
    if d < 0:
        ad = -d
        level = 3 if ad > 3 * sigma else 2 if ad > 2 * sigma else 1 if ad > sigma else 0
        return _ZONE_BELOW[level]
    return "center"


def build_points(target: int, sigma: int, readings: list[int]) -> list[dict[str, Any]]:
    points: list[dict[str, Any]] = []
    for i, value in enumerate(readings):
        d = value - target
        points.append(
            {
                "index": i,
                "value": value,
                "deviation": d,
                "side": "above" if d > 0 else "below" if d < 0 else "center",
                "beyond_1s": d > sigma or d < -sigma,
                "beyond_2s": d > 2 * sigma or d < -2 * sigma,
                "beyond_3s": d > 3 * sigma or d < -3 * sigma,
                "zone": _zone(d, sigma),
            }
        )
    return points


def _candidates(points: list[dict[str, Any]], sigma: int) -> list[tuple]:
    """生成全部命中候选，返回 (结束下标, rule_id, 证据下标序列, side, threshold)。

    排序在 evaluate 中统一按 (结束下标, 规则顺序, 证据序列字典序) 完成；
    同窗口的上下两侧命中在数学上互斥，证据序列字典序仅作确定性兜底。
    """
    n = len(points)
    candidates: list[tuple] = []

    # R1：一点严格越过 3σ
    for i, p in enumerate(points):
        if abs(p["deviation"]) > 3 * sigma:
            candidates.append((i, "R1", (i,), p["side"], "3sigma"))

    # R2：连续三点中至少两点严格越过同侧 2σ
    for end in range(2, n):
        window = points[end - 2 : end + 1]
        above = tuple(p["index"] for p in window if p["deviation"] > 2 * sigma)
        below = tuple(p["index"] for p in window if p["deviation"] < -2 * sigma)
        if len(above) >= 2:
            candidates.append((end, "R2", above, "above", "2sigma"))
        if len(below) >= 2:
            candidates.append((end, "R2", below, "below", "2sigma"))

    # R3：连续五点中至少四点严格越过同侧 1σ
    for end in range(4, n):
        window = points[end - 4 : end + 1]
        above = tuple(p["index"] for p in window if p["deviation"] > sigma)
        below = tuple(p["index"] for p in window if p["deviation"] < -sigma)
        if len(above) >= 4:
            candidates.append((end, "R3", above, "above", "1sigma"))
        if len(below) >= 4:
            candidates.append((end, "R3", below, "below", "1sigma"))

    # R4：连续八点严格位于中心线同侧（中心点不属于任何一侧）
    for end in range(7, n):
        window = points[end - 7 : end + 1]
        above = tuple(p["index"] for p in window if p["deviation"] > 0)
        below = tuple(p["index"] for p in window if p["deviation"] < 0)
        if len(above) == 8:
            candidates.append((end, "R4", tuple(range(end - 7, end + 1)), "above", "center"))
        if len(below) == 8:
            candidates.append((end, "R4", tuple(range(end - 7, end + 1)), "below", "center"))

    return candidates


def evaluate(target: int, sigma: int, readings: list[int]) -> dict[str, Any]:
    """返回判定结果，前端表格与 SVG 共用此响应。"""
    points = build_points(target, sigma, readings)
    candidates = _candidates(points, sigma)

    violation: dict[str, Any] | None = None
    if candidates:
        # 先结束下标，再规则编号顺序，最后证据下标序列字典序
        end, rule_id, evidence_idx, side, threshold = min(
            candidates, key=lambda c: (c[0], RULE_ORDER.index(c[1]), c[2])
        )
        violation = {
            "rule_id": rule_id,
            "rule_name": RULE_NAMES[rule_id],
            "threshold": threshold,
            "side": side,
            "end_index": end,
            "evidence_indices": list(evidence_idx),
            "evidence": [points[i] for i in evidence_idx],
        }

    return {
        "target": target,
        "sigma": sigma,
        "limits": {
            "center": target,
            "ucl_3s": target + 3 * sigma,
            "lcl_3s": target - 3 * sigma,
            "upper_2s": target + 2 * sigma,
            "lower_2s": target - 2 * sigma,
            "upper_1s": target + sigma,
            "lower_1s": target - sigma,
        },
        "stable": violation is None,
        "violation": violation,
        "points": points,
    }
