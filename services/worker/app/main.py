import os

from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app import jobs

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def require_worker_key(x_worker_key: str = Header(...)) -> None:
    if x_worker_key != os.environ["WORKER_KEY"]:
        raise HTTPException(status_code=401, detail="invalid worker key")


class ProcessRequest(BaseModel):
    rehearsal_id: str


class DetectPreviewRequest(BaseModel):
    rehearsal_id: str
    params: dict = {}


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/process", status_code=202, dependencies=[Depends(require_worker_key)])
def process(body: ProcessRequest, background_tasks: BackgroundTasks) -> dict:
    background_tasks.add_task(jobs.run_process, body.rehearsal_id)
    return {"status": "processing"}


@app.post("/detect-preview", dependencies=[Depends(require_worker_key)])
def detect_preview(body: DetectPreviewRequest) -> dict:
    segments = jobs.run_detect_preview(body.rehearsal_id, body.params)
    return {"segments": segments}
