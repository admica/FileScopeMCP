<script lang="ts">
  import Navbar from './components/Navbar.svelte';
  import Project from './routes/Project.svelte';
  import System from './routes/System.svelte';
  import Settings from './routes/Settings.svelte';
  import { fetchRepos, type RepoListItem } from './lib/api';

  let repos: RepoListItem[] = $state([]);
  let hash = $state(window.location.hash || '#/');
  let loading = $state(true);

  $effect(() => {
    const handler = () => { hash = window.location.hash || '#/'; };
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  });

  $effect(() => {
    fetchRepos().then(r => {
      repos = r;
      loading = false;
      // If on root hash and repos exist, navigate to first repo
      if ((hash === '#/' || hash === '#') && r.length > 0) {
        window.location.hash = `#/project/${r[0].name}`;
      }
    }).catch(err => {
      console.error('Failed to load repos:', err);
      loading = false;
    });
  });

  type Route =
    | { type: 'project'; name: string }
    | { type: 'project-file'; name: string; filePath: string }
    | { type: 'project-dir'; name: string; dirPath: string }
    | { type: 'project-graph'; name: string }
    | { type: 'project-graph-file'; name: string; filePath: string }
    | { type: 'system' }
    | { type: 'settings' }
    | { type: 'home' };

  let route: Route = $derived.by(() => {
    const path = hash.replace(/^#/, '') || '/';
    if (path.startsWith('/project/')) {
      const rest = path.slice(9); // strip '/project/'

      // Check for graph routes FIRST (before /file/ and /dir/ — avoids fallback match)
      const graphFileIdx = rest.indexOf('/graph/file/');
      const graphIdx = rest.indexOf('/graph');
      if (graphFileIdx !== -1) {
        return {
          type: 'project-graph-file' as const,
          name: decodeURIComponent(rest.slice(0, graphFileIdx)),
          filePath: rest.slice(graphFileIdx + 12),
        };
      }
      if (graphIdx !== -1 && rest.slice(graphIdx) === '/graph') {
        return {
          type: 'project-graph' as const,
          name: decodeURIComponent(rest.slice(0, graphIdx)),
        };
      }

      // Existing checks for /file/ and /dir/
      const fileIdx = rest.indexOf('/file/');
      const dirIdx = rest.indexOf('/dir/');
      if (fileIdx !== -1) {
        return {
          type: 'project-file',
          name: decodeURIComponent(rest.slice(0, fileIdx)),
          filePath: rest.slice(fileIdx + 6),
        };
      }
      if (dirIdx !== -1) {
        return {
          type: 'project-dir',
          name: decodeURIComponent(rest.slice(0, dirIdx)),
          dirPath: rest.slice(dirIdx + 5),
        };
      }
      return { type: 'project', name: decodeURIComponent(rest) };
    }
    if (path === '/system') return { type: 'system' };
    if (path === '/settings') return { type: 'settings' };
    return { type: 'home' };
  });
</script>

<div class="min-h-screen flex flex-col">
  <Navbar {repos} {hash} />
  <main class="flex-1">
    {#if loading}
      <div class="flex items-center justify-center h-64">
        <p class="text-gray-500">Loading...</p>
      </div>
    {:else if route.type === 'project'}
      <Project repoName={route.name} filePath={null} dirPath={null} showGraph={false} />
    {:else if route.type === 'project-file'}
      <Project repoName={route.name} filePath={route.filePath} dirPath={null} showGraph={false} />
    {:else if route.type === 'project-dir'}
      <Project repoName={route.name} filePath={null} dirPath={route.dirPath} showGraph={false} />
    {:else if route.type === 'project-graph'}
      <Project repoName={route.name} filePath={null} dirPath={null} showGraph={true} />
    {:else if route.type === 'project-graph-file'}
      <Project repoName={route.name} filePath={route.filePath} dirPath={null} showGraph={true} />
    {:else if route.type === 'system'}
      <System />
    {:else if route.type === 'settings'}
      <Settings />
    {:else if repos.length > 0}
      <Project repoName={repos[0].name} filePath={null} dirPath={null} showGraph={false} />
    {:else}
      <div class="flex items-center justify-center h-64">
        <p class="text-gray-500">No repos discovered. Add repos in Settings.</p>
      </div>
    {/if}
  </main>
</div>
