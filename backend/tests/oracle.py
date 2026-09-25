"""独立的朴素窗口扫描 oracle，与 app.engine 分开书写，用于对拍。

刻意使用最直白的逐窗口重扫写法，不共享被测代码的任何抽象。
"""
from __future__ import annotations

from typing import Any


def naive_zone(value: int, target: int, sigma: int) -> str:
    d = value - target
    if d == 0:
        return "center"
    ad = abs(d)
    if ad > 3 * sigma:
        band = "beyond"
    elif ad > 2 * sigma:
        band = "A"
    elif ad > sigma:
        band = "B"
    else:
        band = "C"
    return f"{band}_{'plus' if d > 0 else 'minus'}"


def naive_violation(target: int, sigma: int, readings: list[int]) -> dict[str, Any] | None:
    n = len(readings)
    d = [x - target for x in readings]
    cands: list[tuple] = []

    # R1
    for i in range(n):
        if d[i] > 3 * sigma or d[i] < -3 * sigma:
            side = "above" if d[i] > 0 else "below"
            cands.append((i, "R1", (i,), side))

    # R2：每个三点窗口从头朴素重扫
    for end in range(2, n):
        for side, cross in (("above", lambda v: v > 2 * sigma),
                            ("below", lambda v: v < -2 * sigma)):
            idx = tuple(i for i in range(end - 2, end + 1) if cross(d[i]))
            if len(idx) >= 2:
                cands.append((end, "R2", idx, side))

    # R3
    for end in range(4, n):
        for side, cross in (("above", lambda v: v > sigma),
                            ("below", lambda v: v < -sigma)):
            idx = tuple(i for i in range(end - 4, end + 1) if cross(d[i]))
            if len(idx) >= 4:
                cands.append((end, "R3", idx, side))

    # R4
    for end in range(7, n):
        idx = tuple(range(end - 7, end + 1))
        if all(d[i] > 0 for i in idx):
            cands.append((end, "R4", idx, "above"))
        elif all(d[i] < 0 for i in idx):
            cands.append((end, "R4", idx, "below"))

    if not cands:
        return None
    rule_rank = {"R1": 0, "R2": 1, "R3": 2, "R4": 3}
    end, rule, idx, side = min(cands, key=lambda c: (c[0], rule_rank[c[1]], c[2]))
    return {"rule_id": rule, "side": side, "end_index": end, "evidence_indices": list(idx)}
