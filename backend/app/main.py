from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .engine import evaluate
from .models import EvalResponse, EvaluateRequest

app = FastAPI(title="控制图规则核验台", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/evaluate", response_model=EvalResponse)
def api_evaluate(req: EvaluateRequest) -> dict:
    return evaluate(req.target, req.sigma, req.readings)
