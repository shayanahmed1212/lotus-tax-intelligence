"""
ml.py — Consolidated ML and data pipeline logic.
Fixed: Strict schema isolation, collision-proof ID normalisation, and human-only entity naming.
"""
import os
import io
import re
import hashlib
import logging
import unicodedata
from collections import defaultdict
from typing import Dict, List, Any, Tuple, Optional

import numpy as np
import pandas as pd
import networkx as nx
from rapidfuzz import fuzz
from sklearn.ensemble import IsolationForest
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.preprocessing import RobustScaler

from config import settings

logger = logging.getLogger(__name__)


# ─── Normalisation helpers ────────────────────────────────────────────────────

_NAME_TITLES = {
    "mr", "mrs", "ms", "miss", "mst", "dr", "ch", "capt", "col", "prof",
    "engr", "eng", "advocate", "adv", "hafiz", "janab", "mohtarma",
}

def normalise_name(name: str) -> str:
    if not isinstance(name, str):
        return ""
    name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    name = re.sub(r"[^\w\s]", " ", name)
    name = re.sub(r"\s+", " ", name).strip().lower()
    tokens = [t for t in name.split(" ") if t not in _NAME_TITLES]
    return " ".join(tokens)


def normalise_cnic(cnic: str) -> str:
    """
    Cleans structural identifiers. For standard CNICs, it preserves digits.
    For fallback reference keys (plates, tracking numbers), it retains alphanumeric uniqueness
    to avoid truncation-based ID collisions (e.g., plate 'PEW-808' becoming just '808').
    """
    if not isinstance(cnic, str):
        return ""
    cleaned = cnic.strip().upper()
    # If it looks like a standard Pakistani CNIC (13 digits, sometimes with dashes)
    digits_only = re.sub(r"[^0-9]", "", cleaned)
    if len(digits_only) == 13:
        return digits_only
    
    # Fallback for unique text keys: Keep alpha characters + numbers, just drop pure punctuation
    return re.sub(r"[^A-Z0-9]", "", cleaned)


_ADDRESS_ABBREVS = [
    (r"\bst\.", "street"), (r"\brd\.", "road"), (r"\bave\.", "avenue"), (r"\bblvd\.", "boulevard"),
    (r"\bph\.", "phase"), (r"\bphs\.", "phase"), (r"\bh\.", "house"), (r"\bbldg\.", "building"),
    (r"\bblk\.", "block"), (r"\bapt\.", "apartment"), (r"\bno\.", "number"),
]

def normalise_address(addr: str) -> str:
    if not isinstance(addr, str):
        return ""
    addr = addr.lower()
    for pattern, full in _ADDRESS_ABBREVS:
        addr = re.sub(pattern, full, addr)
    addr = re.sub(r"[^\w\s]", " ", addr)
    return re.sub(r"\s+", " ", addr).strip()


def safe_float(value: Any, default: float = 0.0) -> float:
    if value is None:
        return default
    if isinstance(value, (int, float)):
        if pd.isna(value):
            return default
        return float(value)
    s = str(value).strip().replace(",", "")
    if not s:
        return default
    m = re.search(r"-?\d+(\.\d+)?", s)
    if not m:
        return default
    try:
        return float(m.group())
    except ValueError:
        return default


def city_from_address(addr: str) -> str:
    if not isinstance(addr, str) or "," not in addr:
        return ""
    return addr.rsplit(",", 1)[-1].strip()


def _entity_id(seed: str) -> str:
    return "E" + hashlib.sha1(seed.encode()).hexdigest()[:10].upper()


def _node_id(prefix: str, value: str) -> str:
    return prefix + "_" + hashlib.sha1(value.encode()).hexdigest()[:8].upper()


# ─── DataLoader ───────────────────────────────────────────────────────────────

class DataLoader:
    # Strict configurations: Explicit targeting prevents columns from cross-contaminating
    SCHEMA_MAP = {
        "tax": {
            "name_cols": ["full_name"],
            "cnic_cols": ["fbr_id"],
            "income_cols": ["declared_income_pkr"],
            "filer_cols": ["filer_status"],
            "city_cols": ["city"],
            "address_cols": ["reported_address"],
        },
        "vehicle": {
            "name_cols": ["owner_name"],
            "cnic_cols": ["vehicle_reg_no"],
            "vehicle_cols": ["vehicle_reg_no"],
            "make_cols": ["vehicle_make_model"],
            "value_cols": ["engine_capacity_cc"],
            "addr_cols": ["owner_address"],
            "city_cols": ["city"],
        },
        "utility": {
            "name_cols": ["consumer_name"],
            "cnic_cols": ["meter_ref_no"],
            "bill_cols": ["avg_monthly_bill_pkr"],
            "address_cols": ["installation_address"],
            "city_cols": ["city"],
        },
        "property": {
            "name_cols": ["buyer_name"],
            "cnic_cols": ["registry_no"],
            "value_cols": ["property_value_pkr"],
            "area_cols": ["area_marla"],
            "location_cols": ["property_address"],
            "city_cols": ["city"],
        },
    }

    CSV_ALIASES = {
        "tax": ["fbr_tax_records.csv", "tax.csv"],
        "vehicle": ["excise_vehicles.csv", "vehicle.csv"],
        "utility": ["disco_consumption.csv", "utility.csv"],
        "property": ["property_transfers.csv", "property.csv"],
    }

    def _find_col(self, df: pd.DataFrame, candidates: List[str]) -> Optional[str]:
        df_cols_lower = {c.lower(): c for c in df.columns}
        for c in candidates:
            if c.lower() in df_cols_lower:
                return df_cols_lower[c.lower()]
        return None

    # Column layout for address-contains-comma CSVs:
    # head = fixed cols before address, tail = fixed cols after address
    _CSV_LAYOUT: Dict[str, Dict] = {
        "utility":  {"head": 2, "tail": 3},   # meter_ref, name | addr | bill, conn, city
        "vehicle":  {"head": 5, "tail": 1},   # reg, name, cc, make, year | addr | city
        "tax":      {"head": 5, "tail": 2, "add_city": True},  # id, name, inc, tax, status | addr | phone, fy
        "property": {"head": 3, "tail": 5},   # reg, buyer, seller | addr | val, date, area, type, city
    }

    def _smart_read_csv(self, path: str, source_type: str) -> Optional[pd.DataFrame]:
        """
        Addresses in the CSVs contain commas and are unquoted, causing pandas column
        misalignment.  We reconstruct each row by anchoring known fixed-position
        columns from head and tail, collapsing the middle into the address column.
        """
        try:
            with open(path, encoding="utf-8") as f:
                lines = f.readlines()
            if not lines:
                return None
            layout = self._CSV_LAYOUT[source_type]
            header_cols = [c.strip() for c in lines[0].strip().split(",")]
            head_n, tail_n = layout["head"], layout["tail"]
            rows = []
            for line in lines[1:]:
                line = line.strip()
                if not line:
                    continue
                parts = [p.strip() for p in line.split(",")]
                head = parts[:head_n]
                tail = parts[len(parts) - tail_n:]
                middle = ", ".join(parts[head_n: len(parts) - tail_n])
                rows.append(head + [middle] + tail)
            out_cols = header_cols.copy()
            if layout.get("add_city") and "city" not in [c.lower() for c in out_cols]:
                out_cols = out_cols + ["city"]
                for r in rows:
                    addr = r[head_n] if len(r) > head_n else ""
                    city = addr.rsplit(",", 1)[-1].strip() if "," in addr else ""
                    r.append(city)
            df = pd.DataFrame(rows, columns=out_cols[:len(rows[0])] if rows else out_cols)
            return df
        except Exception as e:
            logger.warning(f"Smart CSV read failed for {path}: {e}")
            return None

    def _read_csv(self, path: str, source_type: str = "") -> Optional[pd.DataFrame]:
        try:
            if source_type in self._CSV_LAYOUT:
                df = self._smart_read_csv(path, source_type)
                if df is not None and len(df) > 0:
                    return df
            df = pd.read_csv(path, encoding="utf-8", low_memory=False)
            df.columns = [c.strip() for c in df.columns]
            return df
        except Exception as e:
            logger.warning(f"Could not read {path}: {e}")
            return None

    def _parse_dataset(self, df: pd.DataFrame, source_type: str) -> List[Dict]:
        schema = self.SCHEMA_MAP[source_type]
        records = []
        name_col = self._find_col(df, schema["name_cols"])
        cnic_col = self._find_col(df, schema["cnic_cols"])
        city_col = self._find_col(df, schema.get("city_cols", []))

        for _, row in df.iterrows():
            raw_city = str(row[city_col]).strip() if city_col and pd.notna(row.get(city_col)) else ""
            if raw_city.lower() in ["nan", "none"]:
                raw_city = ""

            raw_name_val = str(row[name_col]).strip() if name_col and pd.notna(row.get(name_col)) else ""
            if raw_name_val.lower() in ["nan", "none"]:
                raw_name_val = ""

            record = {
                "source_type": source_type,
                "raw_name": raw_name_val,
                "norm_name": normalise_name(raw_name_val),
                "raw_cnic": str(row[cnic_col]).strip() if cnic_col and pd.notna(row.get(cnic_col)) else "",
                "norm_cnic": normalise_cnic(str(row[cnic_col]) if cnic_col and pd.notna(row.get(cnic_col)) else ""),
                "city": raw_city,
            }

            if source_type == "tax":
                income_col = self._find_col(df, schema["income_cols"])
                addr_col = self._find_col(df, schema["address_cols"])
                record["declared_income"] = safe_float(row.get(income_col)) if income_col else 0.0
                record["address"] = normalise_address(str(row[addr_col]) if addr_col else "")
                if not record["city"] and record["address"]:
                    record["city"] = city_from_address(str(row[addr_col]))

            elif source_type == "vehicle":
                veh_col = self._find_col(df, schema["vehicle_cols"])
                make_col = self._find_col(df, schema["make_cols"])
                val_col = self._find_col(df, schema["value_cols"])
                record["vehicle_no"] = str(row[veh_col]).strip() if veh_col else ""
                record["vehicle_make"] = str(row[make_col]).strip() if make_col else ""
                record["engine_cc"] = safe_float(row.get(val_col)) if val_col else 0.0

            elif source_type == "utility":
                bill_col = self._find_col(df, schema["bill_cols"])
                addr_col = self._find_col(df, schema["address_cols"])
                record["monthly_bill"] = safe_float(row.get(bill_col)) if bill_col else 0.0
                record["address"] = normalise_address(str(row[addr_col]) if addr_col else "")
                if not record["city"] and record["address"]:
                    record["city"] = city_from_address(str(row[addr_col]))

            elif source_type == "property":
                val_col = self._find_col(df, schema["value_cols"])
                area_col = self._find_col(df, schema["area_cols"])
                loc_col = self._find_col(df, schema["location_cols"])
                record["property_value"] = safe_float(row.get(val_col)) if val_col else 0.0
                
                raw_area = safe_float(row.get(area_col)) if area_col else 0.0
                if area_col and "marla" in area_col.lower():
                    record["area_sqft"] = raw_area * 225.0
                else:
                    record["area_sqft"] = raw_area
                    
                record["location"] = str(row[loc_col]).strip() if loc_col else ""
                if not record["city"] and record["location"]:
                    record["city"] = city_from_address(record["location"])

            records.append(record)
        return records

    def load_all_samples(self) -> Dict[str, List[Dict]]:
        data = {}
        for source_type in ["tax", "vehicle", "utility", "property"]:
            df = None
            for fname in self.CSV_ALIASES.get(source_type, [f"{source_type}.csv"]):
                path = os.path.join(settings.DATA_DIR, fname)
                if os.path.exists(path):
                    df = self._read_csv(path)
                    if df is not None and len(df) > 0:
                        data[source_type] = self._parse_dataset(df, source_type)
                        logger.info(f"Loaded {len(data[source_type])} records from {fname}")
                        break
            if source_type not in data:
                logger.warning(f"No CSV found for {source_type} — generating synthetic data.")
                data[source_type] = self._generate_synthetic(source_type)
        return data

    def load_from_bytes(self, content: bytes, source_type: str) -> List[Dict]:
        df = pd.read_csv(io.BytesIO(content), encoding="utf-8", low_memory=False)
        df.columns = [c.strip() for c in df.columns]
        return self._parse_dataset(df, source_type)

    def _generate_synthetic(self, source_type: str) -> List[Dict]:
        import random
        names = [
            "Muhammad Ali Khan", "Aisha Siddiqui", "Bilal Ahmed", "Fatima Malik",
            "Usman Raza", "Zainab Hussain", "Tariq Mehmood", "Nadia Shah"
        ]
        cities = ["Lahore", "Karachi", "Islamabad"]
        cnics = [f"35201{i:08d}" for i in range(len(names))]
        random.seed(42)
        records = []

        if source_type == "tax":
            for i, name in enumerate(names):
                records.append({
                    "source_type": "tax", "raw_name": name, "norm_name": normalise_name(name),
                    "raw_cnic": cnics[i], "norm_cnic": cnics[i], "city": random.choice(cities),
                    "declared_income": float(random.choice([500000, 1200000, 3500000])),
                    "address": f"House {i+1}, Street 5, DHA, Lahore",
                })
        else:
            # Basic fallback array generator to satisfy core tests
            for i, name in enumerate(names):
                records.append({
                    "source_type": source_type, "raw_name": name, "norm_name": normalise_name(name),
                    "raw_cnic": cnics[i], "norm_cnic": cnics[i], "city": random.choice(cities),
                    "vehicle_no": f"ICT-LE-{i+100}", "vehicle_make": "Toyota Corolla", "engine_cc": 1300.0,
                    "monthly_bill": 15000.0, "property_value": 45000000.0, "area_sqft": 2250.0, "location": "DHA"
                })
        return records


# ─── EntityResolver ───────────────────────────────────────────────────────────

class EntityResolver:
    def __init__(self):
        self._tfidf: Optional[TfidfVectorizer] = None
        self._tfidf_matrix = None
        self._all_names: List[str] = []

    def _build_tfidf_index(self, records: List[Dict]):
        names = [r["norm_name"] for r in records if r.get("norm_name")]
        if not names:
            return
        self._tfidf = TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 4), min_df=1)
        self._tfidf_matrix = self._tfidf.fit_transform(names)
        self._all_names = names

    def _tfidf_similarity(self, query: str) -> Dict[str, float]:
        if self._tfidf is None or not query:
            return {}
        query_vec = self._tfidf.transform([query])
        sims = cosine_similarity(query_vec, self._tfidf_matrix).flatten()
        return {self._all_names[i]: float(sims[i]) for i in range(len(self._all_names))}

    def _confidence_score(self, a: Dict, b: Dict, name_sim: float, tfidf_sim: float) -> float:
        score = 0.0
        cn_a, cn_b = a.get("norm_cnic", ""), b.get("norm_cnic", "")
        
        # Exact real CNIC match gets full structural merging weight
        if cn_a and cn_b and len(cn_a) == 13 and cn_a == cn_b:
            score += 0.55
        elif cn_a and cn_b and cn_a == cn_b:
            # Alphanumeric reference tracking match (e.g. same precise plate or registry no)
            score += 0.35

        score += name_sim * 0.50
        score += tfidf_sim * 0.15
        
        if a.get("city", "").lower().strip() == b.get("city", "").lower().strip() != "":
            score += 0.05
            
        addr_a, addr_b = a.get("address", ""), b.get("address", "")
        if addr_a and addr_b:
            score += (fuzz.token_set_ratio(addr_a, addr_b) / 100.0) * 0.20
        return min(score, 1.0)

    def resolve(self, raw_data: Dict[str, List[Dict]]) -> Dict[str, Dict]:
        all_records: List[Dict] = []
        for records in raw_data.values():
            all_records.extend(records)
            
        logger.info(f"Resolving {len(all_records)} unique input segments...")
        self._build_tfidf_index(all_records)

        # Unified Grouping: Resolve entities gracefully using fuzzy name similarity matches
        name_groups: List[List[Dict]] = []
        remaining = all_records.copy()
        
        while remaining:
            seed = remaining.pop(0)
            if not seed.get("norm_name"):
                continue
            group = [seed]
            tfidf_sims = self._tfidf_similarity(seed["norm_name"])
            kept = []
            for cand in remaining:
                if not cand.get("norm_name"):
                    continue
                
                # Check for explicit identifier link or a strong name match similarity string
                id_match = (seed.get("norm_cnic") and cand.get("norm_cnic") and seed["norm_cnic"] == cand["norm_cnic"])
                fuzzy_sim = fuzz.token_sort_ratio(seed["norm_name"], cand["norm_name"]) / 100.0
                tfidf_sim = tfidf_sims.get(cand["norm_name"], 0.0)
                
                if id_match or fuzzy_sim >= 0.68 or self._confidence_score(seed, cand, fuzzy_sim, tfidf_sim) >= 0.58:
                    group.append(cand)
                else:
                    kept.append(cand)
            name_groups.append(group)
            remaining = kept

        entities: Dict[str, Dict] = {}
        for group in name_groups:
            # Generate stable, unique reference hashes for the grouped nodes
            seed_record = group[0]
            eid = _entity_id(f"resolved_entity:{seed_record['norm_name']}")
            entities[eid] = self._merge_group(eid, group, "cross_dataset_fuzzy")

        return entities

    def _merge_group(self, eid: str, group: List[Dict], primary_signal: str) -> Dict:
        tax_recs = [r for r in group if r["source_type"] == "tax" and r.get("raw_name")]
        prop_recs = [r for r in group if r["source_type"] == "property" and r.get("raw_name")]
        util_recs = [r for r in group if r["source_type"] == "utility" and r.get("raw_name")]
        veh_recs = [r for r in group if r["source_type"] == "vehicle" and r.get("raw_name")]

        # Determine the cleanest, most complete human identity string available
        if tax_recs:
            canonical_name = tax_recs[0]["raw_name"]
        elif prop_recs:
            canonical_name = prop_recs[0]["raw_name"]
        elif util_recs:
            canonical_name = util_recs[0]["raw_name"]
        elif veh_recs:
            canonical_name = veh_recs[0]["raw_name"]
        else:
            canonical_name = max((r["raw_name"] for r in group if r.get("raw_name")), key=len, default="Unknown Entity")

        # Strip out common placeholder prefixes for cleaner presentation labels
        canonical_name = re.sub(r"^(Mr\.|Mrs\.|Ms\.|Ch\.|Dr\.)\s+", "", canonical_name, flags=re.IGNORECASE).strip()

        # Extract standard real CNICs if present, or assign fallback tracking keys cleanly
        cnic = next((r["raw_cnic"] for r in group if r.get("raw_cnic")), None)
        addresses = [r.get("address", "") for r in group if r.get("address")]
        cities = [r["city"] for r in group if r.get("city")]
        
        vehicles = [{"no": r.get("vehicle_no"), "make": r.get("vehicle_make"), "cc": r.get("engine_cc")} for r in group if r["source_type"] == "vehicle"]
        properties = [{"value": r.get("property_value"), "area_sqft": r.get("area_sqft"), "location": r.get("location")} for r in group if r["source_type"] == "property"]
        utility_bills = [{"monthly_bill": r.get("monthly_bill"), "address": r.get("address")} for r in group if r["source_type"] == "utility"]

        tags = []
        if vehicles: tags.append("vehicle_owner")
        if properties: tags.append("property_owner")
        if not tax_recs: tags.append("non_filer")
        
        declared_income = max((r.get("declared_income", 0.0) for r in group), default=0.0)

        return {
            "id": eid, 
            "canonical_name": canonical_name, 
            "name": canonical_name,
            "cnic": cnic,
            "address": addresses[0] if addresses else None,
            "city": max(set(cities), key=cities.count) if cities else "Islamabad",
            "declared_income": declared_income,
            "vehicles": vehicles, 
            "properties": properties, 
            "utility_bills": utility_bills,
            "tags": tags,
            "source_datasets": list({r["source_type"] for r in group}),
            "resolution_signal": primary_signal, 
            "record_count": len(group),
        }

    def merge_incremental(self, existing: Dict[str, Dict], new_entities: Dict[str, Dict]) -> Dict[str, Dict]:
        merged = {**existing}
        for eid, ent in new_entities.items():
            if eid not in merged:
                merged[eid] = ent
            else:
                for key in ["vehicles", "properties", "utility_bills"]:
                    merged[eid][key] = list({str(i): i for i in merged[eid].get(key, []) + ent.get(key, [])}.values())
                merged[eid]["tags"] = list(set(merged[eid].get("tags", [])) | set(ent.get("tags", [])))
                merged[eid]["source_datasets"] = list(set(merged[eid].get("source_datasets", [])) | set(ent.get("source_datasets", [])))
        return merged


# ─── GraphBuilder ─────────────────────────────────────────────────────────────

class GraphBuilder:
    def build(self, entities: Dict[str, Dict]) -> nx.DiGraph:
        G = nx.DiGraph()
        for eid, entity in entities.items():
            if not entity.get("canonical_name"):
                continue
            G.add_node(eid, label=entity["canonical_name"], type="person",
                       city=entity.get("city",""), declared_income=entity.get("declared_income",0),
                       tags=entity.get("tags",[]), cnic=entity.get("cnic",""))

            for v in entity.get("vehicles", []):
                vno = v.get("no", "")
                if not vno: continue
                vid = _node_id("V", vno)
                if not G.has_node(vid):
                    G.add_node(vid, label=f"{v.get('make','Vehicle')} ({vno})", type="vehicle",
                               make=v.get("make",""), engine_cc=v.get("cc",0), registration_no=vno)
                G.add_edge(eid, vid, relation="OWNS", weight=1.0)

            for i, p in enumerate(entity.get("properties", [])):
                loc = p.get("location") or entity.get("city", f"Property {i}")
                pid = _node_id("P", f"{eid}_{i}_{loc}")
                val = p.get("value", 0)
                if not G.has_node(pid):
                    G.add_node(pid, label=f"Property · {loc[:20]}", type="property",
                               value=val, area_sqft=p.get("area_sqft",0), location=loc)
                G.add_edge(eid, pid, relation="OWNS", weight=min(val/5_000_000, 1.0))

            for i, bill in enumerate(entity.get("utility_bills", [])):
                amount = bill.get("monthly_bill", 0) or 0
                bid = _node_id("U", f"{eid}_{i}")
                if not G.has_node(bid):
                    G.add_node(bid, label=f"Utility Bill · PKR {amount:,.0f}/mo", type="utility",
                               monthly_bill=amount, address=bill.get("address",""))
                G.add_edge(eid, bid, relation="HAS_BILL", weight=min(amount/50_000, 1.0))

            city = entity.get("city", "")
            if city:
                cid = _node_id("C", city)
                if not G.has_node(cid):
                    G.add_node(cid, label=city, type="city")
                G.add_edge(eid, cid, relation="REGISTERED_AT", weight=0.5)

        address_map: Dict[str, list] = {}
        for eid, entity in entities.items():
            addr = entity.get("address", "")
            if addr and len(addr) > 10:
                address_map.setdefault(addr, []).append(eid)
        for addr, eids in address_map.items():
            if len(eids) > 1:
                for i in range(len(eids)):
                    for j in range(i+1, len(eids)):
                        if not G.has_edge(eids[i], eids[j]):
                            G.add_edge(eids[i], eids[j], relation="LINKED_TO", weight=0.3)

        return G

    def subgraph(self, G: nx.DiGraph, entity_id: str, depth: int = 2) -> nx.DiGraph:
        if entity_id not in G:
            return nx.DiGraph()
        nodes, frontier = set(), {entity_id}
        for _ in range(depth):
            next_f = set()
            for n in frontier:
                next_f |= set(G.successors(n)) | set(G.predecessors(n))
            nodes |= frontier
            frontier = next_f - nodes
        nodes |= frontier
        return G.subgraph(nodes).copy()


# ─── RiskEngine ───────────────────────────────────────────────────────────────

FEATURE_NAMES = [
    "declared_income_log", "vehicle_count", "max_vehicle_cc", "property_count",
    "total_property_value_log", "max_monthly_bill", "income_vs_bill_ratio",
    "income_vs_property_ratio", "degree_centrality", "pagerank",
    "asset_diversity", "non_filer_flag",
]

def _extract_features(entity: Dict, G: nx.DiGraph) -> np.ndarray:
    income = max(entity.get("declared_income", 0) or 0, 0)
    vehicles = entity.get("vehicles", [])
    properties = entity.get("properties", [])
    bills = entity.get("utility_bills", [])

    total_prop_val = sum(p.get("value", 0) or 0 for p in properties)
    max_bill = max((b.get("monthly_bill", 0) or 0 for b in bills), default=0)
    income_vs_bill = max_bill / (income/12 + 1) if income > 0 else float(max_bill > 0) * 10
    income_vs_property = total_prop_val / (income + 1) if income > 0 else float(total_prop_val > 0) * 50

    eid = entity["id"]
    degree = G.degree(eid) if eid in G else 0
    n_nodes = G.number_of_nodes()
    degree_centrality = degree / (n_nodes - 1) if n_nodes > 1 else 0
    try:
        pr = nx.pagerank(G, alpha=0.85, max_iter=100)
        pagerank = pr.get(eid, 0)
    except Exception:
        pagerank = 0

    return np.array([
        np.log1p(income),
        len(vehicles),
        max((v.get("engine_cc", 0) or 0 for v in vehicles), default=0) / 4000.0,
        len(properties),
        np.log1p(total_prop_val),
        np.log1p(max_bill),
        min(income_vs_bill, 100),
        min(income_vs_property, 1000),
        degree_centrality,
        pagerank * 1000,
        len(set(entity.get("source_datasets", []))) / 4.0,
        1.0 if "non_filer" in entity.get("tags", []) else 0.0,
    ], dtype=np.float64)


def _tier(score: float) -> str:
    if score >= 75: return "high_risk"
    if score >= 45: return "suspicious"
    return "safe"


def _feature_label(fname: str, val: float, entity: Dict) -> str:
    income = entity.get("declared_income", 0) or 0
    labels = {
        "declared_income_log": f"Declared income: PKR {income:,.0f}/yr" if income else "No declared income on record",
        "vehicle_count": f"{len(entity.get('vehicles',[]))} registered vehicle(s)",
        "max_vehicle_cc": f"High-displacement engine ({int(val*4000)}cc)" if val > 0.5 else "Standard vehicle",
        "property_count": f"{len(entity.get('properties',[]))} property registered",
        "total_property_value_log": f"Total property value: PKR {sum(p.get('value',0) or 0 for p in entity.get('properties',[])):.0f}",
        "max_monthly_bill": f"Max utility bill: PKR {max((b.get('monthly_bill',0) or 0 for b in entity.get('utility_bills',[])), default=0):,.0f}/mo",
        "income_vs_bill_ratio": "Utility bills disproportionate to declared income" if val > 5 else "Utility bills within income range",
        "income_vs_property_ratio": "Property holdings far exceed income level" if val > 10 else "Property aligned with income",
        "degree_centrality": "Highly connected in civic network" if val > 0.05 else "Normal civic connectivity",
        "pagerank": "Central node in knowledge graph" if val > 0.5 else "Peripheral graph node",
        "asset_diversity": f"Present across {round(val*4)} dataset(s)",
        "non_filer_flag": "Not registered as a tax filer" if val > 0.5 else "Registered tax filer",
    }
    return labels.get(fname, fname)


def _explain(entity: Dict, feature_vec: np.ndarray, risk_score: float) -> Dict[str, Any]:
    contributions = sorted(
        [{"feature": n, "value": round(float(feature_vec[i]), 4),
          "impact": round(abs(float(feature_vec[i])), 4),
          "label": _feature_label(n, float(feature_vec[i]), entity)}
         for i, n in enumerate(FEATURE_NAMES)],
        key=lambda x: x["impact"], reverse=True
    )
    flag_triggers = [c["label"] for c in contributions[:3] if c["impact"] > 0.5]

    income = entity.get("declared_income", 0) or 0
    n_vehicles = len(entity.get("vehicles", []))
    n_props = len(entity.get("properties", []))
    max_bill = max((b.get("monthly_bill", 0) or 0 for b in entity.get("utility_bills", [])), default=0)
    total_prop_val = sum(p.get("value", 0) or 0 for p in entity.get("properties", []))
    name = entity.get("canonical_name", "Individual")

    tier_desc = "significant financial anomalies" if risk_score >= 75 else ("moderate financial inconsistencies" if risk_score >= 45 else "a generally consistent financial profile")
    parts = [f"{name} exhibits {tier_desc}."]
    if income == 0 and (n_vehicles > 0 or n_props > 0):
        parts.append("No declared income is on record despite ownership of taxable assets.")
    elif income > 0 and total_prop_val > income * 20:
        parts.append(f"Declared annual income of PKR {income:,.0f} is inconsistent with property holdings valued at PKR {total_prop_val:,.0f}.")
    if n_vehicles >= 3:
        parts.append(f"Ownership of {n_vehicles} vehicles suggests wealth above the declared tax bracket.")
    if max_bill > 30000 and income < max_bill * 12:
        parts.append(f"Monthly utility bills of PKR {max_bill:,.0f} imply a lifestyle inconsistent with declared earnings.")

    graph_paths = []
    for v in entity.get("vehicles", []):
        graph_paths.append(f"{name} → OWNS → {v.get('make','Vehicle')} ({v.get('no')})")
    for i, p in enumerate(entity.get("properties", [])):
        graph_paths.append(f"{name} → OWNS → Property at {str(p.get('location'))[:25]} (PKR {p.get('value',0):,.0f})")
    for b in entity.get("utility_bills", []):
        if b.get("monthly_bill", 0):
            graph_paths.append(f"{name} → HAS_BILL → Utility PKR {b['monthly_bill']:,.0f}/mo")

    return {
        "summary": " ".join(parts),
        "feature_contributions": contributions[:6],
        "graph_paths": graph_paths[:8],
        "confidence": round(min(risk_score / 100, 1.0), 2),
        "flag_triggers": flag_triggers,
    }


class RiskEngine:
    def score_all(self, entities: Dict[str, Dict], G: nx.DiGraph) -> Tuple[Dict[str, float], Dict[str, Dict]]:
        if not entities:
            return {}, {}

        entity_ids = list(entities.keys())
        X = np.array([_extract_features(entities[eid], G) for eid in entity_ids])
        X = np.nan_to_num(X, nan=0.0, posinf=100.0, neginf=0.0)

        X_scaled = RobustScaler().fit_transform(X)
        iso = IsolationForest(n_estimators=200, contamination=settings.ISOLATION_FOREST_CONTAMINATION,
                              max_samples="auto", random_state=42, n_jobs=-1)
        iso.fit(X_scaled)
        raw = iso.score_samples(X_scaled)
        risk_pct = ((1.0 - (raw - raw.min()) / (raw.max() - raw.min() + 1e-9)) * 100).clip(0, 100)

        risk_scores: Dict[str, float] = {}
        xai_cache: Dict[str, Dict] = {}
        for i, eid in enumerate(entity_ids):
            score = float(risk_pct[i])
            risk_scores[eid] = score
            xai_cache[eid] = _explain(entities[eid], X[i], score)
            entities[eid]["risk_score"] = score
            entities[eid]["risk_tier"] = _tier(score)

        return risk_scores, xai_cache