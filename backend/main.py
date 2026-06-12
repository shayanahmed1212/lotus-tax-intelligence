"""
main.py — FastAPI application entry point with all API routers consolidated.
Routes: /dashboard, /entities, /graph, /ingest, /analysis
"""

import logging
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException, Query, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware

from config import (
    settings,
    GraphNode, GraphEdge, GraphResponse,
    EntityProfile, XAIReasoning,
    DashboardEntity, DashboardStats,
    SearchResponse, IngestResponse,
    ScoreDistributionBucket, AnalyticsResponse,
)
from state import AppState

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger(__name__)


# ─── Lifespan ─────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initialising Lotus Tax Intelligence backend…")
    await AppState.get().initialise()
    logger.info("Backend ready.")
    yield
    logger.info("Shutting down.")


# ─── App ──────────────────────────────────────────────────────────────────────

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.API_VERSION,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Helper ───────────────────────────────────────────────────────────────────

def _to_dashboard_entity(eid: str, ent: dict, score: float) -> DashboardEntity:
    name_value = ent.get("canonical_name") or ent.get("name") or "Unknown Entity"
    return DashboardEntity(
        id=eid,
        canonical_name=name_value,
        name=name_value,  # Populated explicitly to protect frontend UI mappings
        cnic=ent.get("cnic"),
        risk_score=round(score, 1),
        risk_tier=ent.get("risk_tier") or "safe",
        tags=ent.get("tags") or [],
        city=ent.get("city") or "Islamabad",
    )


# ─── Dashboard ────────────────────────────────────────────────────────────────

@app.get("/dashboard/stats", response_model=DashboardStats, tags=["Dashboard"])
async def dashboard_stats():
    return AppState.get().get_dashboard_stats()


@app.get("/dashboard/entities", response_model=SearchResponse, tags=["Dashboard"])
async def list_entities(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    tier: Optional[str] = Query(None, description="Filter: high_risk | suspicious | safe"),
    city: Optional[str] = None,
    sort_by: str = Query("risk_score", description="risk_score | name"),
):
    state = AppState.get()
    items = [
        _to_dashboard_entity(eid, ent, state.risk_scores.get(eid, 0))
        for eid, ent in state.entities.items()
    ]
    if tier:
        items = [i for i in items if i.risk_tier == tier]
    if city:
        items = [i for i in items if (i.city or "").lower() == city.lower()]
    if sort_by == "name":
        items.sort(key=lambda x: x.canonical_name.lower())
    else:
        items.sort(key=lambda x: x.risk_score, reverse=True)
    total = len(items)
    start = (page - 1) * page_size
    return SearchResponse(results=items[start: start + page_size], total=total)


@app.get("/dashboard/search", response_model=SearchResponse, tags=["Dashboard"])
async def search_entities(
    q: str = Query(..., min_length=1),
    limit: int = Query(20, ge=1, le=100),
):
    state = AppState.get()
    raw = state.search(q, limit=limit)
    results = [
        _to_dashboard_entity(r["id"], r, r.get("risk_score", 0))
        for r in raw
    ]
    return SearchResponse(results=results, total=len(results))


# ─── Entities ─────────────────────────────────────────────────────────────────

@app.get("/entities/{entity_id}", response_model=EntityProfile, tags=["Entities"])
async def get_entity(entity_id: str):
    state = AppState.get()
    ent = state.get_entity(entity_id)
    if not ent:
        raise HTTPException(status_code=404, detail="Entity not found")
    score = state.risk_scores.get(entity_id, 0.0)
    xai_raw = state.xai_cache.get(entity_id, {})
    xai = XAIReasoning(
        summary=xai_raw.get("summary", ""),
        feature_contributions=xai_raw.get("feature_contributions", []),
        graph_paths=xai_raw.get("graph_paths", []),
        confidence=xai_raw.get("confidence", 0.0),
        flag_triggers=xai_raw.get("flag_triggers", []),
    )
    vehicles = ent.get("vehicles", [])
    properties = ent.get("properties", [])
    return EntityProfile(
        id=entity_id,
        canonical_name=ent.get("canonical_name", ""),
        cnic=ent.get("cnic"),
        address=ent.get("address"),
        risk_score=round(score, 1),
        risk_tier=ent.get("risk_tier", "safe"),
        tags=ent.get("tags", []),
        assets={
            "vehicles": vehicles,
            "properties": properties,
            "utility_bills": ent.get("utility_bills", []),
        },
        declared_income=ent.get("declared_income"),
        xai=xai,
        source_datasets=ent.get("source_datasets", []),
    )


# ─── Graph ────────────────────────────────────────────────────────────────────

@app.get("/graph/{entity_id}", response_model=GraphResponse, tags=["Graph"])
async def get_entity_graph(entity_id: str, depth: int = Query(2, ge=1, le=3)):
    from ml import GraphBuilder
    state = AppState.get()
    if entity_id not in state.entities:
        raise HTTPException(status_code=404, detail="Entity not found")

    sub = GraphBuilder().subgraph(state.graph, entity_id, depth=depth)
    nodes = []
    for nid, data in sub.nodes(data=True):
        score = state.risk_scores.get(nid) if data.get("type") == "person" else None
        
        # Robust evaluation to catch explicit attributes or fallbacks cleanly
        node_value = data.get("value") or data.get("monthly_bill") or data.get("engine_cc") or ""
        
        nodes.append(GraphNode(
            id=nid,
            label=data.get("label", nid),
            type=data.get("type", "unknown"),
            value=str(node_value),
            risk_score=round(score, 1) if score is not None else None,
        ))
    edges = [
        GraphEdge(source=u, target=v, relation=data.get("relation", "LINKED_TO"))
        for u, v, data in sub.edges(data=True)
    ]
    return GraphResponse(nodes=nodes, edges=edges)


# ─── Ingest ───────────────────────────────────────────────────────────────────

@app.post("/ingest", response_model=IngestResponse, tags=["Ingest"])
async def ingest_csv(
    file: UploadFile = File(...),
    source_type: str = Query(..., description="tax | vehicle | utility | property"),
):
    if source_type not in ("tax", "vehicle", "utility", "property"):
        raise HTTPException(status_code=400, detail="source_type must be one of: tax, vehicle, utility, property")
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are accepted")

    from ml import DataLoader, EntityResolver
    content = await file.read()
    try:
        new_records = DataLoader().load_from_bytes(content, source_type)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Failed to parse CSV: {e}")

    new_entities = EntityResolver().resolve({source_type: new_records})
    state = AppState.get()
    before = len(state.entities)
    state.reload(new_entities, source_tag=source_type)
    after = len(state.entities)

    return IngestResponse(
        status="ok",
        source=source_type,
        rows_processed=len(new_records),
        new_entities=max(after - before, 0),
        updated_entities=len(new_entities) - max(after - before, 0),
    )


# ─── Analysis ─────────────────────────────────────────────────────────────────

@app.get("/analysis", response_model=AnalyticsResponse, tags=["Analysis"])
async def get_analytics():
    state = AppState.get()
    scores = list(state.risk_scores.values())

    buckets = [
        ScoreDistributionBucket(range="0–20",  count=sum(1 for s in scores if s < 20),  color="#22c55e"),
        ScoreDistributionBucket(range="20–40", count=sum(1 for s in scores if 20 <= s < 40), color="#84cc16"),
        ScoreDistributionBucket(range="40–60", count=sum(1 for s in scores if 40 <= s < 60), color="#eab308"),
        ScoreDistributionBucket(range="60–75", count=sum(1 for s in scores if 60 <= s < 75), color="#f97316"),
        ScoreDistributionBucket(range="75–100",count=sum(1 for s in scores if s >= 75),   color="#ef4444"),
    ]

    city_scores: dict = {}
    city_counts: dict = {}
    for eid, ent in state.entities.items():
        city = ent.get("city") or "Unknown"
        sc = state.risk_scores.get(eid, 0)
        city_scores[city] = city_scores.get(city, 0) + sc
        city_counts[city] = city_counts.get(city, 0) + 1
    city_risk = {c: round(city_scores[c] / city_counts[c], 1) for c in city_scores if city_counts[c] > 0}

    top_flagged_raw = sorted(
        [
            _to_dashboard_entity(eid, ent, state.risk_scores.get(eid, 0))
            for eid, ent in state.entities.items()
        ],
        key=lambda x: x.risk_score,
        reverse=True,
    )[:10]

    dataset_coverage = {}
    for ent in state.entities.values():
        for ds in ent.get("source_datasets", []):
            dataset_coverage[ds] = dataset_coverage.get(ds, 0) + 1

    return AnalyticsResponse(
        score_distribution=buckets,
        city_risk=city_risk,
        top_flagged=top_flagged_raw,
        dataset_coverage=dataset_coverage,
    )


# ─── Health ───────────────────────────────────────────────────────────────────

@app.get("/health", tags=["Meta"])
async def health():
    state = AppState.get()
    return {
        "status": "ok",
        "entities": len(state.entities),
        "graph_nodes": state.graph.number_of_nodes(),
        "graph_edges": state.graph.number_of_edges(),
    }


# ─── Dev entry point ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)