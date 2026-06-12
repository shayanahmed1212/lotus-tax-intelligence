import axios from "axios";
import type {
  SearchResponse,
  DashboardStats,
  EntityProfile,
  GraphData,
  AnalyticsResponse,
  DashboardEntity,
} from "@/types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const client = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
  headers: { "Content-Type": "application/json" },
});

// Retry interceptor for transient errors
client.interceptors.response.use(
  (res) => res,
  async (err) => {
    const config = err.config;
    if (!config || config._retryCount >= 2) return Promise.reject(err);
    config._retryCount = (config._retryCount || 0) + 1;
    await new Promise((r) => setTimeout(r, 500 * config._retryCount));
    return client(config);
  }
);

export const api = {
  // Dashboard
  getStats: (): Promise<DashboardStats> =>
    client.get("/api/dashboard/stats").then((r) => r.data),

  listEntities: (params?: {
    page?: number;
    limit?: number;
    tier?: string;
    sort_by?: string;
  }): Promise<SearchResponse> =>
    client.get("/api/dashboard/entities", { params }).then((r) => r.data),

  search: (q: string, limit = 20): Promise<SearchResponse> =>
    client.get("/api/dashboard/search", { params: { q, limit } }).then((r) => r.data),

  // Entity profile
  getProfile: (id: string): Promise<EntityProfile> =>
    client.get(`/api/entities/${id}`).then((r) => r.data),

  // Knowledge graph
  getGraph: (id: string, depth = 2): Promise<GraphData> =>
    client.get(`/api/graph/${id}`, { params: { depth } }).then((r) => r.data),

  // Analytics
  getAnalytics: (): Promise<AnalyticsResponse> =>
    client.get("/api/analysis/").then((r) => r.data),

  // Ingest
  uploadCsv: (file: File, sourceType: string): Promise<unknown> => {
    const form = new FormData();
    form.append("file", file);
    form.append("source_type", sourceType);
    return client
      .post("/api/ingest/upload", form, {
        headers: { "Content-Type": "multipart/form-data" },
      })
      .then((r) => r.data);
  },
};