<script lang="ts">
  import FileTree from '../components/FileTree.svelte';
  import DetailPanel from '../components/DetailPanel.svelte';

  let {
    repoName,
    filePath,
    dirPath,
  }: {
    repoName: string;
    filePath: string | null;
    dirPath: string | null;
  } = $props();

  let treeWidth = $state(30); // percent

  function onDividerPointerDown(e: PointerEvent) {
    const container = (e.currentTarget as HTMLElement).parentElement!;
    const startX = e.clientX;
    const startWidth = treeWidth;

    function onMove(ev: PointerEvent) {
      const delta = ev.clientX - startX;
      const containerWidth = container.getBoundingClientRect().width;
      const newPct = startWidth + (delta / containerWidth) * 100;
      treeWidth = Math.max(15, Math.min(70, newPct)); // clamp 15%–70%
    }
    function onUp() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    e.preventDefault();
  }

  function handleSelectFile(path: string) {
    window.location.hash = `#/project/${encodeURIComponent(repoName)}/file/${path}`;
  }

  function handleSelectDir(path: string) {
    window.location.hash = `#/project/${encodeURIComponent(repoName)}/dir/${path}`;
  }
</script>

<div class="flex flex-1 overflow-hidden" style="height: calc(100vh - 3rem)">
  <!-- Left panel: file tree -->
  <div class="overflow-y-auto border-r border-gray-700" style="width: {treeWidth}%">
    <FileTree
      {repoName}
      selectedPath={filePath ?? dirPath}
      onSelectFile={handleSelectFile}
      onSelectDir={handleSelectDir}
    />
  </div>

  <!-- Resizable divider -->
  <div
    role="separator"
    aria-label="Resize panels"
    class="w-1 bg-gray-700 hover:bg-blue-500 cursor-col-resize flex-shrink-0 transition-colors"
    onpointerdown={onDividerPointerDown}
  ></div>

  <!-- Right panel: detail -->
  <div class="flex-1 overflow-y-auto">
    <DetailPanel
      {repoName}
      selectedFile={filePath}
      selectedDir={dirPath}
    />
  </div>
</div>
