from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel, Field

Status = Literal["active", "inactive", "archived"]


class HealthResponse(BaseModel):
    status: str = "ok"
    timestamp: datetime


class ShowtimeStatusUpdate(BaseModel):
    showtime_id: str = Field(..., min_length=1)
    status: Status


app = FastAPI(
    title="Scope Backend Assessment API",
    version="0.1.0",
    description="Minimal FastAPI scaffold for the backend assessment.",
)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(timestamp=datetime.utcnow())
