export type RepoListItem = { name: string; path: string; online: boolean };
export type RepoStats = {
  totalFiles: number;
  withSummary: number;
  withConcepts: number;
  staleCount: number;
  totalDeps: number;
};

export async function fetchRepos(): Promise<RepoListItem[]> {
  const res = await fetch('/api/repos');
  if (!res.ok) throw new Error(`Failed to fetch repos: ${res.status}`);
  return res.json();
}

export async function fetchProjectStats(repoName: string): Promise<RepoStats> {
  const res = await fetch(`/api/project/${encodeURIComponent(repoName)}/stats`);
  if (!res.ok) throw new Error(`Failed to fetch stats for ${repoName}: ${res.status}`);
  return res.json();
}

// ─── Tree types ───────────────────────────────────────────────────────────────

export type TreeEntry = {
  name: string;
  path: string;
  isDir: boolean;
  importance: number;
  hasSummary: boolean;
  isStale: boolean;
};

export type TreeResponse = { entries: TreeEntry[] };

// ─── File detail types ────────────────────────────────────────────────────────

export type ConceptsResult = {
  functions: string[];
  classes: string[];
  interfaces: string[];
  exports: string[];
  purpose: string;
};

export type ChangeImpactResult = {
  riskLevel: 'low' | 'medium' | 'high';
  affectedAreas: string[];
  breakingChanges: string[];
  summary: string;
};

export type ExportedSymbol = {
  name: string;
  kind: 'function' | 'class' | 'variable' | 'type' | 'interface' | 'enum' | 'default';
  signature: string;
};

export type ExportSnapshot = {
  filePath: string;
  exports: ExportedSymbol[];
  imports: string[];
  capturedAt: number;
};

export type FileDetail = {
  path: string;
  name: string;
  importance: number;
  summary: string | null;
  concepts: ConceptsResult | null;
  changeImpact: ChangeImpactResult | null;
  exportsSnapshot: ExportSnapshot | null;
  staleness: {
    summary: number | null;
    concepts: number | null;
    changeImpact: number | null;
  };
  dependencies: { path: string; type: string }[];
  dependents: { path: string }[];
  packageDeps: { name: string; version: string; isDev: boolean }[];
};

// ─── Graph types ─────────────────────────────────────────────────────────────

export type GraphNode = {
  path: string;
  name: string;
  importance: number;
  directory: string;
  hasSummary: boolean;
  isStale: boolean;
};

export type GraphEdge = { source: string; target: string };

export type GraphResponse = { nodes: GraphNode[]; edges: GraphEdge[] };

// ─── Directory detail types ───────────────────────────────────────────────────

export type DirDetail = {
  path: string;
  name: string;
  totalFiles: number;
  avgImportance: number;
  pctWithSummary: number;
  pctStale: number;
  topFiles: { path: string; name: string; importance: number }[];
};

// ─── Fetch wrappers ───────────────────────────────────────────────────────────

export async function fetchTree(repoName: string, dirPath?: string): Promise<TreeResponse> {
  const base = `/api/project/${encodeURIComponent(repoName)}/tree`;
  const url = dirPath ? `${base}/${dirPath}` : base;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Tree fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchFileDetail(repoName: string, filePath: string): Promise<FileDetail> {
  const res = await fetch(`/api/project/${encodeURIComponent(repoName)}/file/${filePath}`);
  if (!res.ok) throw new Error(`File detail fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchDirDetail(repoName: string, dirPath: string): Promise<DirDetail> {
  const res = await fetch(`/api/project/${encodeURIComponent(repoName)}/dir/${dirPath}`);
  if (!res.ok) throw new Error(`Dir detail fetch failed: ${res.status}`);
  return res.json();
}

// ─── Graph fetch ─────────────────────────────────────────────────────────────

export async function fetchGraph(repoName: string, dir?: string): Promise<GraphResponse> {
  const base = `/api/project/${encodeURIComponent(repoName)}/graph`;
  const url = dir ? `${base}?dir=${encodeURIComponent(dir)}` : base;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Graph fetch failed: ${res.status}`);
  return res.json();
}

// ─── System types ─────────────────────────────────────────────────────────────

export type BrokerStatus = {
  online: boolean;
  pendingCount: number;
  inProgressJob: { repoPath: string; filePath: string; jobType: string } | null;
  connectedClients: number;
  repoTokens: Record<string, number>;
  model: string;
};

export type TokenEntry = {
  repo: string;
  total: number;
  sessionDelta: number;
};

export type LogLine = {
  timestamp: string;
  prefix: string;
  message: string;
  source: 'broker' | 'mcp-server';
};

// ─── System fetch ─────────────────────────────────────────────────────────────

export async function fetchBrokerStatus(): Promise<BrokerStatus> {
  const res = await fetch('/api/system/broker');
  if (!res.ok) throw new Error(`Broker status fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchTokenStats(): Promise<TokenEntry[]> {
  const res = await fetch('/api/system/tokens');
  if (!res.ok) throw new Error(`Token stats fetch failed: ${res.status}`);
  return res.json();
}
