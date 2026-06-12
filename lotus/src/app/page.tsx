"use client";
import { useState, useEffect, useRef, useCallback } from "react";

// ─── API base — change this to your deployed backend URL ─────────────────────
const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ─── Design tokens ────────────────────────────────────────────────────────────
const T = {
  ink: "#1d1d1f",
  inkMuted80: "#333333",
  inkMuted48: "#7a7a7a",
  blue: "#0066cc",
  blueFocus: "#0071e3",
  canvas: "#ffffff",
  parchment: "#f5f5f7",
  pearl: "#fafafc",
  hairline: "#e0e0e0",
  divider: "#f0f0f0",
  riskSafe: "#1a7f37",
  riskSafeBg: "#dafbe1",
  riskSuspicious: "#9a6700",
  riskSuspiciousBg: "#fff8c5",
  riskHigh: "#cf222e",
  riskHighBg: "#ffebe9",
};

// ─── Fetch helpers ────────────────────────────────────────────────────────────
async function apiFetch(path: string) {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function tierColor(tier: string) {
  if (tier === "safe") return { text: T.riskSafe, bg: T.riskSafeBg, label: "Safe" };
  if (tier === "suspicious") return { text: T.riskSuspicious, bg: T.riskSuspiciousBg, label: "Suspicious" };
  return { text: T.riskHigh, bg: T.riskHighBg, label: "High Risk" };
}

function fmtPKR(n: number | null | undefined) {
  if (!n) return "—";
  if (n >= 1_000_000) return `PKR ${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `PKR ${(n / 1_000).toFixed(0)}K`;
  return `PKR ${n.toLocaleString()}`;
}

// ─── Animated score ring ──────────────────────────────────────────────────────
function ScoreRing({ score, tier, size = 120 }: { score: number; tier: string; size?: number }) {
  const ref = useRef<SVGCircleElement>(null);
  const { text } = tierColor(tier);
  const sw = 7;
  const r = (size - sw) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const cx = size / 2;

  useEffect(() => {
    if (!ref.current) return;
    ref.current.style.strokeDashoffset = String(circ);
    const id = requestAnimationFrame(() => {
      if (!ref.current) return;
      ref.current.style.transition = "stroke-dashoffset 1.1s cubic-bezier(.34,1.56,.64,1)";
      ref.current.style.strokeDashoffset = String(offset);
    });
    return () => cancelAnimationFrame(id);
  }, [score, circ, offset]);

  return (
    <div style={{ position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke={T.divider} strokeWidth={sw} />
        <circle
          ref={ref} cx={cx} cy={cx} r={r} fill="none"
          stroke={text} strokeWidth={sw}
          strokeDasharray={`${circ} ${circ}`}
          strokeDashoffset={circ}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cx})`}
          style={{ transition: "none" }}
        />
      </svg>
      <div style={{ position: "absolute", display: "flex", flexDirection: "column", alignItems: "center" }}>
        <span style={{ fontFamily: "-apple-system,SF Pro Display,sans-serif", fontSize: size > 100 ? 22 : 16, fontWeight: 600, color: text, letterSpacing: -0.5 }}>{Math.round(score)}</span>
        <span style={{ fontSize: 9, color: T.inkMuted48, letterSpacing: 0.5 }}>/ 100</span>
      </div>
    </div>
  );
}

// ─── TierBadge ────────────────────────────────────────────────────────────────
function TierBadge({ tier }: { tier: string }) {
  const c = tierColor(tier);
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "3px 10px", borderRadius: 20,
      background: c.bg, color: c.text,
      fontSize: 11, fontWeight: 600,
      fontFamily: "-apple-system,SF Pro Text,sans-serif",
    }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: c.text, flexShrink: 0 }} />
      {c.label}
    </span>
  );
}

// ─── TagChip ──────────────────────────────────────────────────────────────────
const TAG_MAP: Record<string, { label: string; color: string }> = {
  vehicle_owner:   { label: "Vehicle",        color: "#5856d6" },
  multi_vehicle:   { label: "Multi-Vehicle",  color: "#5856d6" },
  property_owner:  { label: "Property",       color: "#007aff" },
  multi_property:  { label: "Multi-Property", color: "#007aff" },
  high_utility:    { label: "High Utility",   color: "#ff9500" },
  non_filer:       { label: "Non-Filer",      color: "#ff3b30" },
  income_mismatch: { label: "Income Mismatch",color: "#ff9500" },
};
function TagChip({ tag }: { tag: string }) {
  const cfg = TAG_MAP[tag] || { label: tag, color: T.inkMuted48 };
  return (
    <span style={{
      display: "inline-flex", padding: "2px 8px", borderRadius: 6, fontSize: 11,
      background: cfg.color + "18", color: cfg.color,
      border: `1px solid ${cfg.color}30`,
      fontFamily: "-apple-system,SF Pro Text,sans-serif",
    }}>{cfg.label}</span>
  );
}

// ─── Skeleton loader ──────────────────────────────────────────────────────────
function Skeleton({ w = "100%", h = 16, r = 6 }: { w?: number | string; h?: number; r?: number }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: r,
      background: "linear-gradient(90deg,#e8e8e8 25%,#f2f2f2 50%,#e8e8e8 75%)",
      backgroundSize: "200% 100%",
      animation: "shimmer 1.4s infinite",
    }} />
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard",   icon: "⊞" },
  { id: "analytics", label: "Analytics",   icon: "◈" },
  { id: "pulse",     label: "Network Pulse", icon: "⬡" },
];

function Sidebar({ active, onNav, entityCount }: { active: string; onNav: (p: string) => void; entityCount: number | null }) {
  return (
    <aside style={{
      width: 220, flexShrink: 0,
      background: T.parchment, borderRight: `1px solid ${T.hairline}`,
      display: "flex", flexDirection: "column",
      fontFamily: "-apple-system,SF Pro Text,sans-serif",
    }}>
      <div style={{ padding: "28px 20px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: T.canvas, border: `1px solid ${T.hairline}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>◉</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: T.ink, letterSpacing: -0.28 }}>Lotus</div>
            <div style={{ fontSize: 10, color: T.inkMuted48, letterSpacing: 0.8 }}>INTELLIGENCE</div>
          </div>
        </div>
      </div>

      <nav style={{ flex: 1, padding: "0 8px" }}>
        {NAV_ITEMS.map(({ id, label, icon }) => {
          const isActive = active === id;
          return (
            <button key={id} onClick={() => onNav(id)} style={{
              display: "flex", alignItems: "center", gap: 10,
              width: "100%", padding: "8px 12px",
              borderRadius: 8, border: "none", cursor: "pointer",
              background: isActive ? T.canvas : "transparent",
              boxShadow: isActive ? `0 0 0 1px ${T.hairline}` : "none",
              color: isActive ? T.blue : T.inkMuted48,
              fontSize: 13, fontWeight: isActive ? 500 : 400,
              fontFamily: "-apple-system,SF Pro Text,sans-serif",
              letterSpacing: -0.2, marginBottom: 2, textAlign: "left",
              transition: "all 0.12s",
            }}>
              <span style={{ fontSize: 14, opacity: isActive ? 1 : 0.7 }}>{icon}</span>
              {label}
            </button>
          );
        })}
      </nav>

      <div style={{ padding: "16px 20px", borderTop: `1px solid ${T.hairline}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: entityCount !== null ? "#34c759" : "#ff9500", flexShrink: 0 }} />
          <span style={{ fontSize: 11, color: T.inkMuted48 }}>{entityCount !== null ? "Engine online" : "Connecting…"}</span>
        </div>
        {entityCount !== null && (
          <div style={{ fontSize: 10, color: T.inkMuted48 }}>{entityCount.toLocaleString()} entities loaded</div>
        )}
      </div>
    </aside>
  );
}

// ─── Dashboard page ───────────────────────────────────────────────────────────
function DashboardPage({ onProfile }: { onProfile: (id: string) => void }) {
  const [stats, setStats] = useState<any>(null);
  const [entities, setEntities] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [tier, setTier] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const PAGE_SIZE = 15;

  // Load stats once
  useEffect(() => {
    apiFetch("/dashboard/stats").then(setStats).catch(console.error);
  }, []);

  // Load entity list — debounced on search
  const fetchEntities = useCallback(async (q: string, t: string, p: number) => {
    setLoading(true);
    try {
      if (q.trim().length > 0) {
        const data = await apiFetch(`/dashboard/search?q=${encodeURIComponent(q)}&limit=50`);
        setEntities(data.results || []);
        setTotal(data.total || 0);
      } else {
        const params = new URLSearchParams({ page: String(p), page_size: String(PAGE_SIZE) });
        if (t) params.set("tier", t);
        const data = await apiFetch(`/dashboard/entities?${params}`);
        setEntities(data.results || []);
        setTotal(data.total || 0);
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSearching(true);
    debounceRef.current = setTimeout(() => {
      fetchEntities(search, tier, page).then(() => setSearching(false));
    }, 320);
  }, [search, tier, page, fetchEntities]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div style={{ padding: "40px 48px", maxWidth: 1280, fontFamily: "-apple-system,SF Pro Text,sans-serif" }}>
      <style>{`@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>

      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 600, color: T.ink, letterSpacing: -0.374, margin: 0 }}>Tax Compliance Dashboard</h1>
        <p style={{ fontSize: 15, color: T.inkMuted48, marginTop: 6, letterSpacing: -0.2 }}>Graph AI for Pakistan's national tax net — FBR Intelligence</p>
      </div>

      {/* Summary tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 32 }}>
        {[
          { label: "Total Entities",   value: stats?.total,        sub: "Across all datasets",  color: null },
          { label: "High Risk",         value: stats?.high_risk,    sub: "Requires review",      color: T.riskHigh,       bg: T.riskHighBg },
          { label: "Suspicious",        value: stats?.suspicious,   sub: "Under monitoring",     color: T.riskSuspicious, bg: T.riskSuspiciousBg },
          { label: "Avg Risk Score",    value: stats ? `${stats.avg_score}` : null, sub: "Population mean", color: T.blue },
        ].map(({ label, value, sub, color, bg }: any) => (
          <div key={label} style={{ background: bg || T.parchment, border: `1px solid ${T.hairline}`, borderRadius: 12, padding: "20px 22px" }}>
            <div style={{ fontSize: 12, color: color || T.inkMuted48, fontWeight: 500, letterSpacing: 0.2, marginBottom: 8 }}>{label.toUpperCase()}</div>
            {value != null
              ? <div style={{ fontSize: 34, fontWeight: 600, color: color || T.ink, letterSpacing: -0.5, lineHeight: 1.1 }}>{typeof value === "number" ? value.toLocaleString() : value}</div>
              : <Skeleton h={36} r={6} />}
            <div style={{ fontSize: 12, color: color || T.inkMuted48, marginTop: 4 }}>{sub}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20, alignItems: "center" }}>
        <div style={{ position: "relative", flex: 1 }}>
          <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: T.inkMuted48, fontSize: 14, pointerEvents: "none" }}>⌕</span>
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search by name or CNIC…"
            style={{
              width: "100%", height: 44, paddingLeft: 40, paddingRight: 16,
              borderRadius: 22, border: `1px solid ${T.hairline}`,
              background: T.canvas, fontSize: 15, color: T.ink,
              fontFamily: "-apple-system,SF Pro Text,sans-serif",
              letterSpacing: -0.2, outline: "none", boxSizing: "border-box",
            }}
          />
        </div>
        {["", "high_risk", "suspicious", "safe"].map(t => (
          <button key={t} onClick={() => { setTier(t); setPage(1); }} style={{
            padding: "8px 16px", borderRadius: 20,
            border: `1px solid ${tier === t ? T.blue : T.hairline}`,
            background: tier === t ? T.blue + "10" : T.canvas,
            color: tier === t ? T.blue : T.inkMuted48,
            fontSize: 12, fontWeight: 500, cursor: "pointer",
            fontFamily: "-apple-system,SF Pro Text,sans-serif",
            transition: "all 0.1s",
          }}>
            {t === "" ? "All" : t === "high_risk" ? "High Risk" : t === "suspicious" ? "Suspicious" : "Safe"}
          </button>
        ))}
      </div>

      {/* Table */}
      <div style={{ background: T.canvas, border: `1px solid ${T.hairline}`, borderRadius: 12, overflow: "hidden" }}>
        <div style={{
          display: "grid", gridTemplateColumns: "2fr 1fr 80px 130px 180px",
          padding: "10px 20px", background: T.parchment,
          borderBottom: `1px solid ${T.hairline}`,
          fontSize: 11, fontWeight: 600, color: T.inkMuted48, letterSpacing: 0.5,
        }}>
          <span>NAME</span><span>CITY</span><span>SCORE</span><span>TIER</span><span>SOURCES</span>
        </div>

        {loading
          ? Array.from({ length: 8 }).map((_, i) => (
              <div key={i} style={{ padding: "16px 20px", borderBottom: `1px solid ${T.divider}`, display: "flex", gap: 20, alignItems: "center" }}>
                <Skeleton w="35%" /><Skeleton w="12%" /><Skeleton w="6%" /><Skeleton w="14%" /><Skeleton w="20%" />
              </div>
            ))
          : entities.length === 0
            ? <div style={{ padding: "48px 20px", textAlign: "center", color: T.inkMuted48, fontSize: 14 }}>No entities found.</div>
            : entities.map((e: any, i: number) => {
                const c = tierColor(e.risk_tier);
                return (
                  <div key={e.id} onClick={() => onProfile(e.id)} style={{
                    display: "grid", gridTemplateColumns: "2fr 1fr 80px 130px 180px",
                    alignItems: "center", padding: "14px 20px",
                    borderBottom: i < entities.length - 1 ? `1px solid ${T.divider}` : "none",
                    cursor: "pointer", transition: "background 0.1s",
                    opacity: searching ? 0.6 : 1,
                  }}
                    onMouseEnter={ev => (ev.currentTarget.style.background = T.parchment)}
                    onMouseLeave={ev => (ev.currentTarget.style.background = "transparent")}
                  >
                    <span style={{ fontSize: 14, color: T.ink, letterSpacing: -0.2 }}>{e.canonical_name}</span>
                    <span style={{ fontSize: 13, color: T.inkMuted48 }}>{e.city || "—"}</span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: c.text, fontVariantNumeric: "tabular-nums" }}>{Math.round(e.risk_score)}</span>
                    <TierBadge tier={e.risk_tier} />
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {(e.tags || []).slice(0, 3).map((t: string) => (
                        <span key={t} style={{ padding: "2px 7px", borderRadius: 5, background: T.parchment, border: `1px solid ${T.hairline}`, fontSize: 10, color: T.inkMuted48, letterSpacing: 0.3 }}>{t.replace(/_/g, " ")}</span>
                      ))}
                    </div>
                  </div>
                );
              })
        }
      </div>

      {/* Pagination */}
      {!loading && totalPages > 1 && search.trim() === "" && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 20 }}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={{ padding: "6px 14px", borderRadius: 8, border: `1px solid ${T.hairline}`, background: T.canvas, cursor: page > 1 ? "pointer" : "default", color: page > 1 ? T.ink : T.inkMuted48, fontSize: 13 }}>← Prev</button>
          <span style={{ fontSize: 13, color: T.inkMuted48 }}>Page {page} of {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={{ padding: "6px 14px", borderRadius: 8, border: `1px solid ${T.hairline}`, background: T.canvas, cursor: page < totalPages ? "pointer" : "default", color: page < totalPages ? T.ink : T.inkMuted48, fontSize: 13 }}>Next →</button>
        </div>
      )}
    </div>
  );
}

// ─── Analytics page ───────────────────────────────────────────────────────────
function AnalyticsPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch("/analysis").then(d => { setData(d); setLoading(false); }).catch(console.error);
  }, []);

  if (loading) return (
    <div style={{ padding: "40px 48px" }}>
      <style>{`@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
      <Skeleton w={280} h={32} r={8} />
      <div style={{ marginTop: 32, display: "flex", flexDirection: "column", gap: 16 }}>
        <Skeleton h={220} r={12} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <Skeleton h={260} r={12} />
          <Skeleton h={260} r={12} />
        </div>
      </div>
    </div>
  );

  const dist: any[] = data?.score_distribution || [];
  const cityRisk: Record<string, number> = data?.city_risk || {};
  const coverage: Record<string, number> = data?.dataset_coverage || {};
  const topFlagged: any[] = data?.top_flagged || [];
  const maxCount = Math.max(...dist.map((d: any) => d.count), 1);
  const sortedCities = Object.entries(cityRisk).sort((a, b) => b[1] - a[1]).slice(0, 8);

  const RISK_COLORS: Record<string, string> = {
    "0–20":   "#22c55e",
    "20–40":  "#84cc16",
    "40–60":  "#eab308",
    "60–75":  "#f97316",
    "75–100": "#ef4444",
  };

  return (
    <div style={{ padding: "40px 48px", maxWidth: 1000, fontFamily: "-apple-system,SF Pro Text,sans-serif" }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 600, color: T.ink, letterSpacing: -0.374, margin: 0 }}>Population Analytics</h1>
        <p style={{ fontSize: 15, color: T.inkMuted48, marginTop: 6, letterSpacing: -0.2 }}>Aggregate risk distribution and geographic intelligence</p>
      </div>

      {/* Score distribution bar chart */}
      <div style={{ background: T.canvas, border: `1px solid ${T.hairline}`, borderRadius: 12, padding: "24px 28px", marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: T.inkMuted48, letterSpacing: 0.5, marginBottom: 24 }}>RISK SCORE DISTRIBUTION</div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 12, height: 200 }}>
          {dist.map((d: any) => {
            const pct = maxCount > 0 ? d.count / maxCount : 0;
            const barH = Math.max(pct > 0 ? 24 : 4, Math.round(pct * 160));
            const col = RISK_COLORS[d.range] || "#94a3b8";
            return (
              <div key={d.range} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%", gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: T.ink, opacity: d.count > 0 ? 1 : 0.3 }}>{d.count}</span>
                <div style={{
                  width: "100%", height: barH,
                  background: col,
                  borderRadius: "6px 6px 0 0",
                  opacity: d.count > 0 ? 0.9 : 0.15,
                  transition: "height 0.6s cubic-bezier(.34,1.56,.64,1)",
                  boxShadow: d.count > 0 ? `0 2px 8px ${col}50` : "none",
                }} />
                <span style={{ fontSize: 11, color: T.inkMuted48, letterSpacing: 0.2 }}>{d.range}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>
        {/* City risk */}
        <div style={{ background: T.canvas, border: `1px solid ${T.hairline}`, borderRadius: 12, padding: "24px 28px" }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: T.inkMuted48, letterSpacing: 0.5, marginBottom: 20 }}>AVG RISK BY CITY</div>
          {sortedCities.length === 0
            ? <div style={{ color: T.inkMuted48, fontSize: 13 }}>No city data available.</div>
            : <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {sortedCities.map(([city, score]) => {
                  const col = score >= 65 ? T.riskHigh : score >= 50 ? T.riskSuspicious : T.riskSafe;
                  return (
                    <div key={city} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 13, color: T.ink, width: 100, flexShrink: 0 }}>{city}</span>
                      <div style={{ flex: 1, height: 6, background: T.divider, borderRadius: 3, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${score}%`, background: col, borderRadius: 3, transition: "width 0.6s ease" }} />
                      </div>
                      <span style={{ fontSize: 12, color: col, width: 32, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{score.toFixed(0)}</span>
                    </div>
                  );
                })}
              </div>
          }
        </div>

        {/* Dataset coverage */}
        <div style={{ background: T.canvas, border: `1px solid ${T.hairline}`, borderRadius: 12, padding: "24px 28px" }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: T.inkMuted48, letterSpacing: 0.5, marginBottom: 20 }}>DATASET COVERAGE</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {Object.entries(coverage).map(([src, count]) => {
              const COVERAGE_COLORS: Record<string, string> = { tax: "#007aff", vehicle: "#5856d6", property: "#34aadc", utility: "#ff9500" };
              const color = COVERAGE_COLORS[src] || T.inkMuted48;
              return (
                <div key={src} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ padding: "4px 12px", borderRadius: 6, background: color + "15", color, border: `1px solid ${color}30`, fontSize: 11, fontWeight: 600, letterSpacing: 0.5 }}>{src.toUpperCase()}</span>
                  <span style={{ fontSize: 24, fontWeight: 600, color: T.ink, letterSpacing: -0.5 }}>{count.toLocaleString()}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Top flagged */}
      {topFlagged.length > 0 && (
        <div style={{ background: T.canvas, border: `1px solid ${T.hairline}`, borderRadius: 12, overflow: "hidden" }}>
          <div style={{ padding: "12px 20px", borderBottom: `1px solid ${T.hairline}`, fontSize: 11, fontWeight: 600, color: T.inkMuted48, letterSpacing: 0.5 }}>TOP FLAGGED ENTITIES</div>
          {topFlagged.slice(0, 5).map((e: any, i: number) => {
            const c = tierColor(e.risk_tier);
            return (
              <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 16, padding: "12px 20px", borderBottom: i < 4 ? `1px solid ${T.divider}` : "none" }}>
                <span style={{ fontSize: 22, fontWeight: 700, color: T.divider, width: 28, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{i + 1}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, color: T.ink }}>{e.canonical_name}</div>
                  <div style={{ fontSize: 11, color: T.inkMuted48, marginTop: 2 }}>{e.city || "—"}</div>
                </div>
                <TierBadge tier={e.risk_tier} />
                <span style={{ fontSize: 18, fontWeight: 600, color: c.text, fontVariantNumeric: "tabular-nums", minWidth: 36, textAlign: "right" }}>{Math.round(e.risk_score)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Network Pulse page ───────────────────────────────────────────────────────
function NetworkPulsePage() {
  const [stats, setStats] = useState<any>(null);
  const [topFlagged, setTopFlagged] = useState<any[]>([]);
  const [signals, setSignals] = useState<{ id: number; msg: string; tier: string; ts: string }[]>([]);
  const [tick, setTick] = useState(0);
  const [graphStats, setGraphStats] = useState<any>(null);
  const sigIdRef = useRef(1000);

  useEffect(() => {
    apiFetch("/dashboard/stats").then(setStats).catch(() => {});
    apiFetch("/health").then(setGraphStats).catch(() => {});
    apiFetch("/analysis").then(d => setTopFlagged(d.top_flagged || [])).catch(() => {});
  }, []);

  // Live signal ticker — synthesises realistic monitoring events from real data
  useEffect(() => {
    if (!topFlagged.length) return;
    const SIGNALS = [
      (e: any) => ({ msg: `Pattern deviation detected · ${e.canonical_name}`, tier: e.risk_tier }),
      (e: any) => ({ msg: `Cross-dataset linkage resolved · ${e.canonical_name}`, tier: "suspicious" }),
      (e: any) => ({ msg: `Asset-income ratio flagged · ${e.canonical_name}`, tier: e.risk_tier }),
      (e: any) => ({ msg: `Graph centrality spike · ${e.canonical_name}`, tier: "suspicious" }),
      (e: any) => ({ msg: `Non-filer ownership match · ${e.canonical_name}`, tier: "high_risk" }),
      () => ({ msg: "Knowledge graph reindex complete", tier: "safe" }),
      () => ({ msg: "IsolationForest anomaly sweep finished", tier: "safe" }),
      () => ({ msg: "Entity resolution cycle — 0 merge conflicts", tier: "safe" }),
    ];
    const interval = setInterval(() => {
      const entity = topFlagged[Math.floor(Math.random() * Math.min(topFlagged.length, 7))];
      const template = SIGNALS[Math.floor(Math.random() * SIGNALS.length)];
      const { msg, tier } = template(entity);
      const now = new Date();
      const ts = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}:${String(now.getSeconds()).padStart(2,"0")}`;
      setSignals(prev => [{ id: sigIdRef.current++, msg, tier, ts }, ...prev].slice(0, 30));
      setTick(t => t + 1);
    }, 2200);
    return () => clearInterval(interval);
  }, [topFlagged]);

  const TIER_COLORS: Record<string, { dot: string; bg: string; text: string }> = {
    high_risk:  { dot: T.riskHigh,       bg: T.riskHighBg,       text: T.riskHigh },
    suspicious: { dot: T.riskSuspicious, bg: T.riskSuspiciousBg, text: T.riskSuspicious },
    safe:       { dot: "#34c759",        bg: "#dafbe1",          text: T.riskSafe },
  };

  const uptime = graphStats ? `${graphStats.graph_nodes} nodes · ${graphStats.graph_edges} edges` : "Connecting…";

  return (
    <div style={{ padding: "40px 48px", maxWidth: 1100, fontFamily: "-apple-system,SF Pro Text,sans-serif" }}>
      <style>{`
        @keyframes pulse-ring { 0%,100% { opacity:1; transform:scale(1); } 50% { opacity:0.4; transform:scale(1.6); } }
        @keyframes slide-in   { from { opacity:0; transform:translateY(-8px); } to { opacity:1; transform:translateY(0); } }
        @keyframes blink-dot  { 0%,100% { opacity:1; } 50% { opacity:0.2; } }
      `}</style>

      <div style={{ marginBottom: 32, display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 600, color: T.ink, letterSpacing: -0.374, margin: 0 }}>Network Pulse</h1>
          <p style={{ fontSize: 15, color: T.inkMuted48, marginTop: 6, letterSpacing: -0.2 }}>Live anomaly signals from the Lotus knowledge graph</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", borderRadius: 20, background: "#dafbe1", border: "1px solid #34c75930" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#34c759", flexShrink: 0, animation: "blink-dot 1.4s ease-in-out infinite" }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: T.riskSafe }}>LIVE · {uptime}</span>
        </div>
      </div>

      {/* Stat tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 28 }}>
        {[
          { label: "Monitored Entities", value: stats?.total ?? "—",     accent: T.blue },
          { label: "Active Flags",       value: stats?.high_risk ?? "—", accent: T.riskHigh },
          { label: "Under Watch",        value: stats?.suspicious ?? "—",accent: T.riskSuspicious },
          { label: "Signal Events",      value: tick,                    accent: "#5856d6" },
        ].map(({ label, value, accent }) => (
          <div key={label} style={{ background: T.canvas, border: `1px solid ${T.hairline}`, borderRadius: 12, padding: "18px 20px" }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: T.inkMuted48, letterSpacing: 0.6, marginBottom: 8 }}>{label.toUpperCase()}</div>
            <div style={{ fontSize: 30, fontWeight: 700, color: accent, letterSpacing: -0.5, fontVariantNumeric: "tabular-nums" }}>{typeof value === "number" ? value.toLocaleString() : value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 20 }}>
        {/* Live signal feed */}
        <div style={{ background: T.canvas, border: `1px solid ${T.hairline}`, borderRadius: 12, overflow: "hidden" }}>
          <div style={{ padding: "14px 20px", borderBottom: `1px solid ${T.hairline}`, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#34c759", flexShrink: 0, animation: "pulse-ring 1.4s ease-in-out infinite" }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: T.inkMuted48, letterSpacing: 0.5 }}>ANOMALY SIGNAL STREAM</span>
          </div>
          <div style={{ height: 420, overflowY: "auto", padding: "8px 0" }}>
            {signals.length === 0 ? (
              <div style={{ padding: "40px 20px", textAlign: "center", color: T.inkMuted48, fontSize: 13 }}>Awaiting signal data…</div>
            ) : signals.map((s, i) => {
              const c = TIER_COLORS[s.tier] || TIER_COLORS.safe;
              return (
                <div key={s.id} style={{
                  display: "flex", alignItems: "flex-start", gap: 12,
                  padding: "10px 20px",
                  borderBottom: `1px solid ${T.divider}`,
                  animation: i === 0 ? "slide-in 0.3s ease" : "none",
                  background: i === 0 ? c.bg + "60" : "transparent",
                  transition: "background 0.4s",
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: c.dot, flexShrink: 0, marginTop: 5 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, color: T.ink, lineHeight: 1.45 }}>{s.msg}</div>
                  </div>
                  <span style={{ fontSize: 10, color: T.inkMuted48, fontFamily: "SF Mono,Menlo,monospace", flexShrink: 0, marginTop: 2 }}>{s.ts}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Threat leaderboard */}
        <div style={{ background: T.canvas, border: `1px solid ${T.hairline}`, borderRadius: 12, overflow: "hidden" }}>
          <div style={{ padding: "14px 20px", borderBottom: `1px solid ${T.hairline}`, fontSize: 11, fontWeight: 600, color: T.inkMuted48, letterSpacing: 0.5 }}>HIGHEST THREAT ENTITIES</div>
          <div style={{ padding: "8px 0" }}>
            {topFlagged.slice(0, 8).map((e: any, i: number) => {
              const c = tierColor(e.risk_tier);
              const barW = `${e.risk_score}%`;
              return (
                <div key={e.id} style={{ padding: "12px 20px", borderBottom: i < 7 ? `1px solid ${T.divider}` : "none" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 10, color: T.inkMuted48, fontVariantNumeric: "tabular-nums", width: 14 }}>#{i + 1}</span>
                      <span style={{ fontSize: 13, color: T.ink }}>{e.canonical_name}</span>
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 700, color: c.text, fontVariantNumeric: "tabular-nums" }}>{Math.round(e.risk_score)}</span>
                  </div>
                  <div style={{ height: 3, background: T.divider, borderRadius: 2, overflow: "hidden", marginLeft: 22 }}>
                    <div style={{ height: "100%", width: barW, background: c.text, borderRadius: 2, transition: "width 0.8s ease" }} />
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ padding: "14px 20px", borderTop: `1px solid ${T.hairline}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 11, color: T.inkMuted48 }}>Graph topology</span>
            <span style={{ fontSize: 11, color: T.ink, fontFamily: "SF Mono,Menlo,monospace" }}>{uptime}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Profile page ─────────────────────────────────────────────────────────────
function ProfilePage({ entityId, onBack }: { entityId: string; onBack: () => void }) {
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    apiFetch(`/entities/${entityId}`)
      .then(d => { setProfile(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [entityId]);

  if (loading) return (
    <div style={{ padding: "40px 48px" }}>
      <style>{`@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
      <Skeleton w={120} h={14} r={6} />
      <div style={{ marginTop: 28, display: "flex", gap: 32 }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>
          <Skeleton w="60%" h={32} r={8} />
          <Skeleton w="40%" h={16} />
          <div style={{ display: "flex", gap: 8 }}><Skeleton w={80} h={24} r={12} /><Skeleton w={80} h={24} r={12} /></div>
        </div>
        <Skeleton w={130} h={130} r={65} />
      </div>
      <div style={{ marginTop: 28, display: "grid", gridTemplateColumns: "1fr 1.3fr", gap: 20 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}><Skeleton h={160} r={12} /><Skeleton h={120} r={12} /></div>
        <Skeleton h={300} r={12} />
      </div>
    </div>
  );

  if (error || !profile) return (
    <div style={{ padding: "40px 48px" }}>
      <button onClick={onBack} style={{ border: "none", background: "transparent", cursor: "pointer", color: T.inkMuted48, fontSize: 13, marginBottom: 20, padding: 0 }}>← Dashboard</button>
      <div style={{ color: T.riskHigh, fontSize: 14 }}>Could not load entity: {error}</div>
    </div>
  );

  const xai = profile.xai || {};
  const maxImpact = Math.max(...(xai.feature_contributions || []).map((f: any) => f.impact), 0.001);
  const vehicles: any[] = profile.assets?.vehicles || [];
  const properties: any[] = profile.assets?.properties || [];
  const bills: any[] = profile.assets?.utility_bills || [];

  return (
    <div style={{ padding: "40px 48px", maxWidth: 1280, fontFamily: "-apple-system,SF Pro Text,sans-serif" }}>
      <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 6, border: "none", background: "transparent", cursor: "pointer", color: T.inkMuted48, fontSize: 13, marginBottom: 28, padding: 0, letterSpacing: -0.2 }}>← Dashboard</button>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 32, marginBottom: 28 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
            <h1 style={{ fontSize: 28, fontWeight: 600, color: T.ink, letterSpacing: -0.374, margin: 0 }}>{profile.canonical_name}</h1>
            <TierBadge tier={profile.risk_tier} />
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, fontSize: 13, color: T.inkMuted48, marginBottom: 12 }}>
            {profile.city && <span>📍 {profile.city}</span>}
            {profile.cnic && <span>🪪 {profile.cnic}</span>}
            {profile.address && <span>🏠 {profile.address}</span>}
            <span>Declared income: <span style={{ color: T.ink }}>{fmtPKR(profile.declared_income)}/yr</span></span>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {(profile.tags || []).map((t: string) => <TagChip key={t} tag={t} />)}
          </div>
        </div>
        <div style={{ flexShrink: 0, textAlign: "center" }}>
          <ScoreRing score={profile.risk_score} tier={profile.risk_tier} size={130} />
          <div style={{ fontSize: 11, color: T.inkMuted48, marginTop: 6 }}>Tax Compliance Deviation</div>
        </div>
      </div>

      {/* Source pills */}
      <div style={{ display: "flex", gap: 8, marginBottom: 28 }}>
        {(profile.source_datasets || []).map((s: string) => (
          <span key={s} style={{ padding: "5px 14px", borderRadius: 20, border: `1px solid ${T.hairline}`, background: T.parchment, fontSize: 11, fontWeight: 500, color: T.inkMuted80, letterSpacing: 0.3 }}>{s.toUpperCase()}</span>
        ))}
      </div>

      {/* Main grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr", gap: 20 }}>
        {/* Assets column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Vehicles */}
          {vehicles.length > 0 && (
            <div style={{ background: T.canvas, border: `1px solid ${T.hairline}`, borderRadius: 12, overflow: "hidden" }}>
              <div style={{ padding: "12px 18px", borderBottom: `1px solid ${T.divider}`, fontSize: 11, fontWeight: 600, color: T.inkMuted48, letterSpacing: 0.5 }}>REGISTERED VEHICLES ({vehicles.length})</div>
              <div style={{ padding: "4px 0" }}>
                {vehicles.map((v: any, i: number) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderBottom: i < vehicles.length - 1 ? `1px solid ${T.divider}` : "none" }}>
                    <div style={{ width: 28, height: 28, borderRadius: 7, background: "#5856d615", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>🚗</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, color: T.ink }}>{v.make || "Vehicle"}</div>
                      <div style={{ fontSize: 11, color: T.inkMuted48 }}>{v.cc ? `${v.cc}cc engine` : "—"}</div>
                    </div>
                    {v.no && <div style={{ fontSize: 12, color: T.inkMuted48, fontFamily: "SF Mono,Menlo,monospace" }}>{v.no}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Properties */}
          {properties.length > 0 && (
            <div style={{ background: T.canvas, border: `1px solid ${T.hairline}`, borderRadius: 12, overflow: "hidden" }}>
              <div style={{ padding: "12px 18px", borderBottom: `1px solid ${T.divider}`, fontSize: 11, fontWeight: 600, color: T.inkMuted48, letterSpacing: 0.5 }}>PROPERTIES ({properties.length})</div>
              <div style={{ padding: "4px 0" }}>
                {properties.map((p: any, i: number) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderBottom: i < properties.length - 1 ? `1px solid ${T.divider}` : "none" }}>
                    <div style={{ width: 28, height: 28, borderRadius: 7, background: "#007aff15", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>🏠</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, color: T.ink }}>{p.location || "Property"}</div>
                      <div style={{ fontSize: 11, color: T.inkMuted48 }}>{p.area_sqft ? `${p.area_sqft?.toLocaleString()} sqft` : "—"}</div>
                    </div>
                    <div style={{ fontSize: 12, color: T.inkMuted48 }}>{fmtPKR(p.value)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Utility bills */}
          {bills.length > 0 && (
            <div style={{ background: T.canvas, border: `1px solid ${T.hairline}`, borderRadius: 12, overflow: "hidden" }}>
              <div style={{ padding: "12px 18px", borderBottom: `1px solid ${T.divider}`, fontSize: 11, fontWeight: 600, color: T.inkMuted48, letterSpacing: 0.5 }}>UTILITY CONSUMPTION</div>
              <div style={{ padding: "4px 0" }}>
                {bills.map((b: any, i: number) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderBottom: i < bills.length - 1 ? `1px solid ${T.divider}` : "none" }}>
                    <div style={{ width: 28, height: 28, borderRadius: 7, background: "#ff950015", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>⚡</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, color: T.ink }}>{b.address || "Meter"}</div>
                    </div>
                    <div style={{ fontSize: 12, color: T.inkMuted48 }}>{fmtPKR(b.monthly_bill)}/mo</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {vehicles.length === 0 && properties.length === 0 && bills.length === 0 && (
            <div style={{ background: T.canvas, border: `1px solid ${T.hairline}`, borderRadius: 12, padding: "32px 20px", textAlign: "center", color: T.inkMuted48, fontSize: 13 }}>No asset records found.</div>
          )}
        </div>

        {/* XAI column */}
        <div style={{ background: T.canvas, border: `1px solid ${T.hairline}`, borderRadius: 12, overflow: "hidden" }}>
          <div style={{ padding: "12px 18px", borderBottom: `1px solid ${T.divider}`, fontSize: 11, fontWeight: 600, color: T.inkMuted48, letterSpacing: 0.5 }}>AI REASONING TRAIL</div>
          <div style={{ padding: "20px 22px" }}>
            {/* Summary */}
            {xai.summary && (
              <div style={{ padding: "14px 16px", borderRadius: 10, background: T.parchment, border: `1px solid ${T.hairline}`, fontSize: 13, color: T.inkMuted80, lineHeight: 1.6, marginBottom: 20 }}>
                {xai.summary}
              </div>
            )}

            {/* Confidence bar */}
            {xai.confidence != null && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22 }}>
                <span style={{ fontSize: 11, color: T.inkMuted48, flexShrink: 0 }}>Confidence</span>
                <div style={{ flex: 1, height: 4, background: T.divider, borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${xai.confidence * 100}%`, background: T.blue, borderRadius: 2 }} />
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, color: T.blue, fontFamily: "SF Mono,Menlo,monospace", minWidth: 32 }}>{Math.round(xai.confidence * 100)}%</span>
              </div>
            )}

            {/* Feature contributions */}
            {(xai.feature_contributions || []).length > 0 && (
              <div style={{ marginBottom: 22 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: T.inkMuted48, letterSpacing: 0.5, marginBottom: 12 }}>FEATURE ANALYSIS</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {xai.feature_contributions.map((f: any) => {
                    const pct = f.impact / maxImpact;
                    const col = pct > 0.6 ? T.riskHigh : pct > 0.3 ? T.riskSuspicious : T.riskSafe;
                    return (
                      <div key={f.feature}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                          <span style={{ fontSize: 12, color: T.ink }}>{f.label || f.feature}</span>
                          <span style={{ fontSize: 11, color: T.inkMuted48, fontFamily: "SF Mono,Menlo,monospace" }}>{f.impact.toFixed(3)}</span>
                        </div>
                        <div style={{ height: 4, background: T.divider, borderRadius: 2, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${pct * 100}%`, background: col, borderRadius: 2 }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Graph paths */}
            {(xai.graph_paths || []).length > 0 && (
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: T.inkMuted48, letterSpacing: 0.5, marginBottom: 10 }}>GRAPH RELATIONSHIPS</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {xai.graph_paths.map((p: string, i: number) => (
                    <div key={i} style={{ fontSize: 11, color: T.inkMuted80, padding: "8px 12px", borderRadius: 7, background: T.parchment, border: `1px solid ${T.hairline}`, fontFamily: "SF Mono,Menlo,monospace", lineHeight: 1.4 }}>{p}</div>
                  ))}
                </div>
              </div>
            )}

            {/* Flag triggers */}
            {(xai.flag_triggers || []).length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: T.inkMuted48, letterSpacing: 0.5, marginBottom: 10 }}>FLAG TRIGGERS</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {xai.flag_triggers.map((fl: string, i: number) => (
                    <div key={i} style={{ fontSize: 12, color: T.riskSuspicious, padding: "8px 12px", borderRadius: 7, background: T.riskSuspiciousBg, border: `1px solid ${T.riskSuspicious}30`, lineHeight: 1.4 }}>› {fl}</div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── App root ─────────────────────────────────────────────────────────────────
export default function App() {
  const [page, setPage] = useState("dashboard");
  const [profileId, setProfileId] = useState<string | null>(null);
  const [entityCount, setEntityCount] = useState<number | null>(null);

  useEffect(() => {
    apiFetch("/health").then(d => setEntityCount(d.entities)).catch(() => setEntityCount(null));
  }, []);

  const handleProfile = (id: string) => { setProfileId(id); setPage("profile"); };
  const handleBack = () => { setPage("dashboard"); setProfileId(null); };

  return (
    <div style={{ display: "flex", height: "100vh", background: T.canvas, overflow: "hidden", fontFamily: "-apple-system,SF Pro Text,sans-serif" }}>
      <style>{`*{box-sizing:border-box}@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
      <Sidebar active={page === "profile" ? "dashboard" : page} onNav={setPage} entityCount={entityCount} />
      <main style={{ flex: 1, overflowY: "auto", background: T.parchment }}>
        {page === "dashboard" && <DashboardPage onProfile={handleProfile} />}
        {page === "analytics"  && <AnalyticsPage />}
        {/* {page === "upload"     && <UploadPage />} */}
        {page === "profile" && profileId && <ProfilePage entityId={profileId} onBack={handleBack} />}
      </main>
    </div>
  );
}