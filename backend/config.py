import os
from pydantic_settings import BaseSettings
from pydantic import BaseModel
from typing import List, Optional, Dict, Any

# ─── Settings ────────────────────────────────────────────────────────────────

class Settings(BaseSettings):
    APP_NAME: str = "Lotus Tax Intelligence"
    API_VERSION: str = "1.0.0"
    CORS_ORIGINS: List[str] = ["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:8000"]

    # Entity resolution thresholds
    FUZZY_MATCH_THRESHOLD: float = 0.82
    EMBEDDING_SIMILARITY_THRESHOLD: float = 0.88
    CONFIDENCE_MERGE_THRESHOLD: float = 0.75

    # Scoring
    ISOLATION_FOREST_CONTAMINATION: float = 0.08

    # Data paths
    DATA_DIR: str = "data"
    FEEDBACK_LOG_PATH: str = "data/feedback_log.jsonl"

    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()


# ─── Schemas ─────────────────────────────────────────────────────────────────

class GraphNode(BaseModel):
    id: str
    label: str
    type: str
    value: Optional[str] = None
    risk_score: Optional[float] = None


class GraphEdge(BaseModel):
    source: str
    target: str
    relation: str


class GraphResponse(BaseModel):
    nodes: List[GraphNode]
    edges: List[GraphEdge]


class XAIReasoning(BaseModel):
    summary: str
    feature_contributions: List[Dict[str, Any]]
    graph_paths: List[str]
    confidence: float
    flag_triggers: List[str]


class EntityProfile(BaseModel):
    id: str
    canonical_name: str
    name: Optional[str] = None  # Added for absolute frontend compatibility
    cnic: Optional[str] = None
    address: Optional[str] = None
    risk_score: float
    risk_tier: str
    tags: List[str]
    assets: Dict[str, Any]
    declared_income: Optional[float] = None
    xai: XAIReasoning
    source_datasets: List[str]


class DashboardEntity(BaseModel):
    id: str
    canonical_name: str
    name: Optional[str] = None  # Added for absolute frontend compatibility
    cnic: Optional[str] = None
    risk_score: float
    risk_tier: str
    tags: List[str]
    city: Optional[str] = None


class DashboardStats(BaseModel):
    total: int
    high_risk: int
    suspicious: int
    safe: int
    avg_score: float


class SearchResponse(BaseModel):
    results: List[DashboardEntity]
    total: int


class IngestResponse(BaseModel):
    status: str
    source: str
    rows_processed: int
    new_entities: int
    updated_entities: int


class ScoreDistributionBucket(BaseModel):
    range: str
    count: int


class AnalyticsResponse(BaseModel):
    score_distribution: List[ScoreDistributionBucket]
    city_risk: Dict[str, float]
    top_flagged: List[DashboardEntity]
    dataset_coverage: Dict[str, int]