from __future__ import annotations
import networkx as nx
import logging
from typing import Dict, List, Optional, Any

logger = logging.getLogger(__name__)
_state: Optional["AppState"] = None


class AppState:
    """Singleton holding the live knowledge graph and entity registry."""

    def __init__(self):
        self.graph: nx.DiGraph = nx.DiGraph()
        self.entities: Dict[str, Dict] = {}
        self.risk_scores: Dict[str, float] = {}
        self.xai_cache: Dict[str, Dict] = {}

    @classmethod
    def get(cls) -> "AppState":
        global _state
        if _state is None:
            _state = cls()
        return _state

    async def initialise(self):
        from ml import DataLoader, EntityResolver, GraphBuilder, RiskEngine
        raw = DataLoader().load_all_samples()
        self.entities = EntityResolver().resolve(raw)
        logger.info(f"Resolved {len(self.entities)} unique entities.")
        self.graph = GraphBuilder().build(self.entities)
        logger.info(f"Graph: {self.graph.number_of_nodes()} nodes, {self.graph.number_of_edges()} edges.")
        self.risk_scores, self.xai_cache = RiskEngine().score_all(self.entities, self.graph)
        logger.info("Risk scoring complete.")

    def reload(self, new_entities: Dict, source_tag: str):
        from ml import EntityResolver, GraphBuilder, RiskEngine
        self.entities = EntityResolver().merge_incremental(self.entities, new_entities)
        self.graph = GraphBuilder().build(self.entities)
        self.risk_scores, self.xai_cache = RiskEngine().score_all(self.entities, self.graph)
        logger.info(f"State reloaded after ingesting: {source_tag}")

    def get_entity(self, entity_id: str) -> Optional[Dict]:
        return self.entities.get(entity_id)

    def search(self, query: str, limit: int = 20) -> List[Dict]:
        q = query.lower().strip()
        results = [
            {**ent, "id": eid, "risk_score": self.risk_scores.get(eid, 0)}
            for eid, ent in self.entities.items()
            if q in ent.get("canonical_name", "").lower() or q in ent.get("cnic", "").lower() or q in ent.get("city", "").lower()
        ]
        results.sort(key=lambda x: x["risk_score"], reverse=True)
        return results[:limit]

    def get_dashboard_stats(self) -> Dict[str, Any]:
        scores = list(self.risk_scores.values())
        if not scores:
            return {"total": 0, "high_risk": 0, "suspicious": 0, "safe": 0, "avg_score": 0}
        
        return {
            "total": len(scores),
            "high_risk": sum(1 for s in scores if s >= 65),
            "suspicious": sum(1 for s in scores if 35 <= s < 65),
            "safe": sum(1 for s in scores if s < 35),
            "avg_score": round(sum(scores) / len(scores), 1)
        }