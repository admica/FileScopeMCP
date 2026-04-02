<script lang="ts">
  import BrokerStatusBar from '../components/BrokerStatusBar.svelte';
  import TokenChart from '../components/TokenChart.svelte';
  import ActivityFeed from '../components/ActivityFeed.svelte';
  import { fetchBrokerStatus, fetchTokenStats, type BrokerStatus, type TokenEntry } from '../lib/api';

  let brokerStatus: BrokerStatus | null = $state(null);
  let tokenEntries: TokenEntry[] = $state([]);
  let pulsing = $state(false);

  // Poll broker status + token stats every 5s (NEXUS-26)
  $effect(() => {
    let interval: ReturnType<typeof setInterval>;

    async function poll() {
      try {
        const [broker, tokens] = await Promise.all([
          fetchBrokerStatus(),
          fetchTokenStats(),
        ]);
        brokerStatus = broker;
        tokenEntries = tokens;
      } catch (err) {
        console.error('System poll error:', err);
        // Don't clear existing data on transient errors
      }
      // Trigger pulse animation (D-05)
      pulsing = true;
      setTimeout(() => { pulsing = false; }, 500);
    }

    poll(); // immediate first poll
    interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  });
</script>

<div class="flex flex-col" style="height: calc(100vh - 48px);">
  <!-- Section 1: Broker Status Bar (D-01) -->
  <BrokerStatusBar status={brokerStatus} {pulsing} />

  <!-- Section 2: Token Chart (D-07) -->
  <div class="flex-shrink-0 px-6 py-4 border-b border-gray-700">
    <h2 class="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">Token Usage</h2>
    <TokenChart entries={tokenEntries} />
  </div>

  <!-- Section 3: Activity Feed fills remaining space (D-15) -->
  <div class="flex-1 min-h-0 overflow-hidden">
    <ActivityFeed />
  </div>
</div>
