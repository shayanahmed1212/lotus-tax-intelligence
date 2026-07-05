# 🪷 Lotus Tax Intelligence

**An AI-powered anomaly detection platform for cross-referencing civic datasets to identify tax/asset declaration mismatches.**

Lotus ingests tax, vehicle, property, and utility records, resolves them into unified real-world entities despite messy inconsistent data, builds a relationship graph between people and their assets, and scores each entity for financial anomaly risk using unsupervised machine learning — with every score backed by a human-readable explanation, not just a number.

---

## 🧠 The ML, Under the Hood

This runs on classical ML and graph theory, not deep learning or LLMs — a deliberate, correct choice for this problem.

- **`IsolationForest`** (scikit-learn) drives the anomaly detection. It's the right tool here because there's no labeled dataset of confirmed tax evaders to train a supervised model on — this is genuinely an unsupervised outlier problem.
- **`RobustScaler`** normalizes features before scoring, since it resists distortion from the very outliers the model is trying to find.
- **12 engineered features** feed the model — income-to-property ratio, vehicle engine size, graph centrality, PageRank, and more — real financial and network signals, not filler.
- **`TfidfVectorizer` + cosine similarity** adds an NLP layer to name matching, working alongside fuzzy string matching for two independent resolution signals.
- **`networkx.pagerank()`** runs on the entity-asset graph, boosting risk scores for entities structurally central to a network of flagged people and assets — e.g., linked through shared addresses or ownership chains.

The hard part isn't the model — it's making the model's input trustworthy: four messy government datasets with no shared primary key, resolved into single entities before any scoring happens.

---

## 🎯 What Problem This Solves

Government datasets about the same person are almost never clean or joined:

- FBR (tax authority): `full_name`, `fbr_id`
- Excise & Taxation: `owner_name`, `vehicle_reg_no`
- DISCOs (utility companies): `consumer_name`, `meter_ref_no`
- Land/property registries: `buyer_name`, `registry_no`

Names are spelled inconsistently, addresses are freeform text, and there's no shared key across all four. Lotus resolves entities first, then asks: *does this person's declared income actually match what they own?*

---

## 🏗️ Architecture

```
DataLoader ──▶ EntityResolver ──▶ GraphBuilder ──▶ RiskEngine
 (ingest)      (fuzzy matching)   (knowledge         (IsolationForest
                                    graph)             + XAI)
                                                            │
                                                            ▼
                                                       AppState (in-memory)
                                                            │
                                                            ▼
                                                       FastAPI app
```

**Backend:** Python · FastAPI · scikit-learn · NetworkX · RapidFuzz · pandas
**Frontend:** Next.js / TypeScript (`lotus/`)

---

## ⚙️ How It Works

**1. Data Ingestion (`DataLoader`)** — Loads four dataset types via a strict schema map (`SCHEMA_MAP`) so columns never cross-contaminate. Handles a real-world CSV problem: unquoted addresses containing commas break naive parsing, so `_smart_read_csv` anchors known fixed columns at the head/tail of each row and reconstructs the address field from the middle. Falls back to seeded synthetic data if no CSV is found.

**2. Entity Resolution (`EntityResolver`)** — Normalizes names (strips honorifics, unicode, punctuation), CNICs (13-digit national IDs vs. fallback alphanumeric keys), and addresses (expands abbreviations). Groups records into entities using a weighted confidence score: exact CNIC match (+0.55), fuzzy name similarity (+0.50), TF-IDF similarity (+0.15), matching city (+0.05), fuzzy address overlap (+0.20). Records merge if they share a CNIC, cross a name-similarity threshold, or cross a combined confidence threshold — a greedy O(n²) pass across all datasets.

**3. Knowledge Graph (`GraphBuilder`)** — Builds a directed graph with people, vehicles, properties, utility bills, and cities as nodes; `OWNS`, `HAS_BILL`, `REGISTERED_AT` as typed edges. People sharing an address get a synthetic `LINKED_TO` edge — this is how the system surfaces assets hidden under a relative's name.

**4. Risk Scoring (`RiskEngine`)** — 12 features scaled and scored via IsolationForest, normalized into a 0–100 risk score, bucketed into `safe` (<45), `suspicious` (45–75), `high_risk` (≥75).

**5. Explainability** — Every score comes with ranked feature contributions in plain English (e.g. *"Property holdings far exceed income level"*), a natural-language summary, and graph-path traversals (e.g. *"Ali Khan → OWNS → Property at DHA Phase 6"*) — turning a black-box score into something a human auditor could actually act on.

---

## 🔌 API Surface

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/dashboard/stats` | Aggregate counts by risk tier |
| `GET` | `/dashboard/entities` | Paginated, filterable entity list |
| `GET` | `/dashboard/search` | Free-text search |
| `GET` | `/entities/{id}` | Full profile + XAI reasoning |
| `GET` | `/graph/{id}?depth=N` | Subgraph for visualization |
| `POST` | `/ingest?source_type=` | Upload CSV, re-resolve + re-score |
| `GET` | `/analysis` | Score distribution, per-city risk, top flagged |
| `GET` | `/health` | Liveness check |

`/ingest` doesn't just append — it re-runs resolution and rescoring across the whole graph, since one new record can shift everyone's relative anomaly score.

---

## 🏃 Running Locally

```bash
cd backend
pip install fastapi uvicorn pydantic-settings pandas numpy networkx rapidfuzz scikit-learn
python main.py
# → http://localhost:8000/docs
```

Drop CSVs into `backend/data/` (`fbr_tax_records.csv`, `excise_vehicles.csv`, `disco_consumption.csv`, `property_transfers.csv`) or run as-is for synthetic demo data.

---

## ⚠️ Known Limitations

- In-memory only — no persistence, state resets on restart
- O(n²) entity resolution — fine at demo scale, needs blocking/indexing at real volume
- Fixed 8% contamination assumption, not calibrated per dataset
- No auth/rate-limiting on `/ingest`
- Synthetic fallback data may not reflect real-world data quality

---

## 💡 Why This Is Interesting

Most portfolio ML projects stop at "train a model, show a metric." This one does the unglamorous 80%: dirty CSVs, inconsistent identifiers, cross-dataset entity matching — then pairs the ML output with real explainability, which is what separates a toy anomaly detector from something a human auditor could actually trust.

---

## 📄 License

MIT © 2026 Shayan Ahmed — see [LICENSE](./LICENSE) for details.
