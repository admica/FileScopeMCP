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
    | { type: 'system' }
    | { type: 'settings' }
    | { type: 'home' };

  let route: Route = $derived.by(() => {
    const path = hash.replace(/^#/, '') || '/';
    if (path.startsWith('/project/')) return { type: 'project', name: decodeURIComponent(path.slice(9)) };
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
      <Project repoName={route.name} />
    {:else if route.type === 'system'}
      <System />
    {:else if route.type === 'settings'}
      <Settings />
    {:else if repos.length > 0}
      <Project repoName={repos[0].name} />
    {:else}
      <div class="flex items-center justify-center h-64">
        <p class="text-gray-500">No repos discovered. Add repos in Settings.</p>
      </div>
    {/if}
  </main>
</div>
