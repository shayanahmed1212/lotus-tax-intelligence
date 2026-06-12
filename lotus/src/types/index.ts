// Core entity types

export type RiskTier = "safe" | "suspicious" | "high_risk";

export interface DashboardEntity {
  id: string;
  canonical_name: string;
  cnic?: string;
  risk_score: number;
  risk_tier: RiskTier;
  tags: string[];
  city?: string;
}

export interface SearchResponse {
  results: DashboardEntity[];
  total: number;
}

export interface DashboardStats {
  total: number;
  high_risk: number;
  suspicious: number;
  safe: number;
  avg_score: number;
}

export interface FeatureContribution {
  feature: string;
  value: number;
  impact: number;
  label: string;
}

export interface XAIReasoning {
  summary: string;
  feature_contributions: FeatureContribution[];
  graph_paths: string[];
  confidence: number;
  flag_triggers: string[];
}

export interface Vehicle {
  no?: string;
  make?: string;
  cc?: number;
}

export interface Property {
  value?: number;
  area_sqft?: number;
  location?: string;
}

export interface UtilityBill {
  monthly_bill?: number;
  address?: string;
}

export interface EntityAssets {
  vehicles: Vehicle[];
  properties: Property[];
  utility_bills: UtilityBill[];
}

export interface EntityProfile {
  id: string;
  canonical_name: string;
  cnic?: string;
  address?: string;
  risk_score: number;
  risk_tier: RiskTier;
  tags: string[];
  assets: EntityAssets;
  declared_income?: number;
  xai: XAIReasoning;
  source_datasets: string[];
}

// Graph types
export interface GraphNode {
  id: string;
  label: string;
  type: "person" | "vehicle" | "property" | "utility" | "city";
  value?: string;
  risk_score?: number;
  // Force graph layout
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface GraphEdge {
  source: string;
  target: string;
  relation: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// Analytics types
export interface ScoreDistributionBucket {
  range: string;
  count: number;
  color: string;
}

export interface AnalyticsResponse {
  score_distribution: ScoreDistributionBucket[];
  city_risk: Record<string, number>;
  top_flagged: DashboardEntity[];
  dataset_coverage: Record<string, number>;
}