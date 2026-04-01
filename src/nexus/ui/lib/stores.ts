import type { RepoListItem } from './api';

// Simple mutable state — Svelte components use $state() locally
// This module is just a shared data holder, not reactive on its own
export let repos: RepoListItem[] = [];

export function setRepos(newRepos: RepoListItem[]) {
  repos = newRepos;
}
