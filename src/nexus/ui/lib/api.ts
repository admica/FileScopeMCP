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
