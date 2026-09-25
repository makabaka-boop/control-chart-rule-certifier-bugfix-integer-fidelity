"""请求 / 响应模型。未知字段拒绝，整数使用严格类型（浮点、布尔均不接受）。"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt


class EvaluateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    target: StrictInt
    sigma: StrictInt = Field(gt=0)
    readings: list[StrictInt] = Field(min_length=2, max_length=200)


class Point(BaseModel):
    index: int
    value: int
    deviation: int
    side: Literal["above", "below", "center"]
    beyond_1s: bool
    beyond_2s: bool
    beyond_3s: bool
    zone: str


class Limits(BaseModel):
    center: int
    ucl_3s: int
    lcl_3s: int
    upper_2s: int
    lower_2s: int
    upper_1s: int
    lower_1s: int


class Violation(BaseModel):
    rule_id: Literal["R1", "R2", "R3", "R4"]
    rule_name: str
    threshold: Literal["3sigma", "2sigma", "1sigma", "center"]
    side: Literal["above", "below"]
    end_index: int
    evidence_indices: list[int]
    evidence: list[Point]


class EvalResponse(BaseModel):
    target: int
    sigma: int
    limits: Limits
    stable: bool
    violation: Violation | None
    points: list[Point]
