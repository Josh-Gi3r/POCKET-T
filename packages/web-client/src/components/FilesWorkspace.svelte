<script lang="ts">
  import PTIcon from './PTIcon.svelte';
  import { status, fileRoots, fileState, fetchFileRoots, browseFolder } from '../lib/store';
  import type { FileEntry } from '../lib/types';

  let rootId = $state<string | null>(null);
  let folder = $state('');
  let filter = $state('');
  let highlighted = $state<FileEntry | null>(null);
  const connected = $derived($status === 'open');
  const listing = $derived($fileState.listing?.rootId === rootId
    && $fileState.listing.relativePath === folder ? $fileState.listing : null);
  const entries = $derived((listing?.entries ?? []).filter((entry) =>
    !filter.trim() || entry.name.toLowerCase().includes(filter.trim().toLowerCase())));
  const activeRoot = $derived($fileRoots.find((r) => r.id === rootId));

  // Every new connection can change the Mac-side approved roots. Refresh
  // when reconnected instead of assuming the original grant remains valid.
  $effect(() => {
    if ($status === 'open') fetchFileRoots();
  });
  $effect(() => {
    if (!rootId && $fileRoots.length > 0) {
      chooseRoot($fileRoots[0]!.id);
    } else if (rootId && !$fileRoots.some((root) => root.id === rootId)) {
      rootId = null;
      folder = '';
      highlighted = null;
    }
  });

  function chooseRoot(id: string) {
    if (!connected) return;
    rootId = id;
    folder = '';
    filter = '';
    highlighted = null;
    browseFolder(id, '');
  }
  function navigate(next: string) {
    if (!connected || !rootId) return;
    folder = next;
    filter = '';
    highlighted = null;
    browseFolder(rootId, next);
  }
  function goUp() {
    if (!folder) return;
    navigate(folder.split('/').slice(0, -1).join('/'));
  }
  function refresh() {
    if (!connected) return;
    fetchFileRoots();
    if (rootId) browseFolder(rootId, folder);
  }
  function displaySize(size: number | null): string {
    if (size == null) return '—';
    if (size < 1024) return size + ' B';
    if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB';
    if (size < 1024 ** 3) return (size / 1024 ** 2).toFixed(1) + ' MB';
    return (size / 1024 ** 3).toFixed(2) + ' GB';
  }
  function kindName(e: FileEntry): string {
    return e.kind === 'directory' ? 'Folder' : e.kind === 'file' ? 'File' : e.kind === 'symlink' ? 'Link (not followed)' : 'Other';
  }
  function chooseEntry(e: FileEntry) {
    if (e.kind === 'directory') navigate(e.relativePath);
    else highlighted = e;
  }
</script>

<section class="files">
  <header class="files-header">
    <div>
      <div class="eyebrow">YOUR MAC <span>/</span> FILES</div>
      <h1>Files & folders<span>.</span></h1>
      <p>Your Mac's files, organised for a smaller screen. File contents and downloads are not enabled in this first release.</p>
    </div>
    <span class="readonly"><PTIcon name="eye" size={15}/> READ-ONLY INVENTORY</span>
  </header>

  <div class="files-panel">
    <div class="files-toolbar">
      <div class="folder-chooser">
        <label for="file-roots">APPROVED FOLDERS</label>
        <select id="file-roots" value={rootId ?? ''} disabled={!connected || !$fileRoots.length} onchange={(event) => chooseRoot(event.currentTarget.value)}>
          {#if !$fileRoots.length}<option value="">No folders authorised</option>{/if}
          {#each $fileRoots as root (root.id)}<option value={root.id}>{root.label}</option>{/each}
        </select>
      </div>
      <button class="refresh" onclick={refresh} disabled={!connected} aria-label="Refresh folder listing"><PTIcon name="refresh" size={17}/> <span>Refresh</span></button>
    </div>

    {#if !connected}
      <div class="empty">
        <div class="empty-icon">⌘</div>
        <strong>Your Mac is disconnected</strong>
        <p>File browsing requires an active, authorised connection to your Mac. No offline file contents are cached here.</p>
      </div>
    {:else if !$fileRoots.length}
      <div class="empty">
        <div class="empty-icon">⌑</div>
        <strong>No folders approved yet</strong>
        <p>Folder access starts OFF. On the Mac, set <code>POCKET_T_FILE_ROOTS</code> to a JSON list of folders that Pocket-T may browse, then restart the daemon. macOS may still deny protected directories.</p>
        <div class="config-note">Example: <code>POCKET_T_FILE_ROOTS='["~/Documents","~/Projects"]'</code></div>
      </div>
    {:else}
      <div class="breadcrumbs">
        <button onclick={() => navigate('')} disabled={!folder} aria-label="Go to folder root"><PTIcon name="home" size={15}/> {activeRoot?.label ?? 'Folder'}</button>
        {#each folder.split('/').filter(Boolean) as segment, index}
          <span>›</span>
          <button onclick={() => navigate(folder.split('/').slice(0, index + 1).join('/'))}>{segment}</button>
        {/each}
      </div>
      <div class="search-row">
        <span class="search-icon"><PTIcon name="search" size={19}/></span>
        <input aria-label="Filter the current directory" type="search" placeholder="Filter files in this folder…" bind:value={filter}/>
        <span>{listing?.entries.length ?? 0} items</span>
      </div>

      {#if $fileState.error}
        <div class="error-msg" role="status">⚠ {$fileState.error}</div>
      {/if}
      {#if $fileState.loading}
        <div class="pending">Reading the approved folder on your Mac…</div>
      {:else if listing}
        {#if folder}<button class="back-folder" onclick={goUp}>← Parent folder</button>{/if}
        <div class="file-list">
          {#each entries as e (e.relativePath)}
            <button class:file-selected={highlighted?.relativePath === e.relativePath} class="file-item" onclick={() => chooseEntry(e)} disabled={e.kind === 'symlink' || e.kind === 'other'}>
              <span class="file-glyph" class:folder={e.kind === 'directory'}><PTIcon name={e.kind === 'directory' ? 'folder' : e.kind === 'file' ? 'file' : 'arrowUpRight'} size={19}/></span>
              <span class="file-details"><strong>{e.name}</strong><small>{kindName(e)}{e.kind === 'file' ? ' · ' + displaySize(e.size) : ''}</small></span>
              <span class="file-open">{e.kind === 'directory' ? '›' : e.kind === 'file' ? 'ⓘ' : '—'}</span>
            </button>
          {/each}
          {#if !entries.length}
            <div class="no-items">{filter ? 'No files match your search.' : 'This folder is empty.'}</div>
          {/if}
        </div>
        {#if listing.truncated}<div class="limit">Showing the first 200 entries. More entries are not fetched automatically.</div>{/if}
      {/if}
    {/if}
  </div>

  {#if highlighted}
    <div class="detail">
      <div><span>SELECTED FILE</span><h3>{highlighted.name}</h3><p>{highlighted.relativePath} · {displaySize(highlighted.size)}</p></div>
      <button onclick={() => (highlighted = null)} aria-label="Dismiss file details">✕</button>
      <div class="detail-foot">File previews, uploads, downloads, edits and OpenAI access require a separate authorised capability. They are not silently enabled.</div>
    </div>
  {/if}

  <footer class="privacy-note"><PTIcon name="shield" size={19}/> <span>Pocket-T lists only the folder metadata you specifically authorise on the Mac. Hidden files, symlink traversal, and file-content transfer are off by default.</span></footer>
</section>

<style>
  .files{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding:42px clamp(23px,4.7vw,76px) 95px;max-width:1260px;width:100%;margin:auto;color:var(--pt-ink);scrollbar-width:thin}
  .files-header{display:flex;align-items:end;justify-content:space-between;gap:15px;margin-bottom:28px}
  .eyebrow{color:var(--pt-tertiary);font-size:10px;font-weight:790;letter-spacing:1.2px}
  .eyebrow span{margin:0 9px;color:var(--pt-line-strong)}
  .files-header h1{font-size:clamp(32px,3.6vw,51px);letter-spacing:-.055em;line-height:1.16;margin:14px 0 9px;font-weight:740}
  .files-header h1 span{color:var(--pt-violet)}
  .files-header p{color:var(--pt-secondary);font-size:13px;max-width:560px;line-height:1.7;margin:0}
  .readonly{display:inline-flex;align-items:center;gap:9px;color:var(--pt-violet);background:var(--pt-violet-soft);border:1px solid transparent;border-radius:100px;padding:11px 13px;font-size:10px;font-weight:770;letter-spacing:.6px;white-space:nowrap}
  .files-panel{border-radius:23px;background:var(--pt-surface);border:1px solid var(--pt-line);box-shadow:var(--pt-shadow);overflow:hidden}
  .files-toolbar{display:flex;align-items:end;gap:12px;justify-content:space-between;padding:21px 22px;border-bottom:1px solid var(--pt-line);background:var(--pt-surface)}
  .folder-chooser{display:grid;gap:9px;min-width:0;width:min(350px,100%)}
  .folder-chooser label{font-size:10px;color:var(--pt-tertiary);font-weight:770;letter-spacing:1px}
  .folder-chooser select{background:var(--pt-surface-soft);color:var(--pt-ink);border:1px solid var(--pt-line);border-radius:12px;font-size:13px;min-height:45px;padding:0 14px}
  .refresh{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:0 13px;border-radius:12px;border:1px solid var(--pt-line);background:var(--pt-surface);color:var(--pt-secondary);font-size:12px;font-weight:750}
  .refresh:hover{background:var(--pt-surface-soft);color:var(--pt-violet)}
  .breadcrumbs{display:flex;flex-wrap:wrap;align-items:center;gap:7px;padding:18px 22px 4px;color:var(--pt-tertiary)}
  .breadcrumbs button{background:none;color:var(--pt-violet);display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:0 4px;border-radius:8px;font-size:12px;font-weight:720;max-width:185px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .breadcrumbs button:disabled{color:var(--pt-secondary);opacity:1}
  .breadcrumbs button:hover:not(:disabled){background:var(--pt-violet-soft)}
  .search-row{display:flex;align-items:center;gap:10px;min-height:49px;margin:11px 20px 8px;border:1px solid var(--pt-line);border-radius:13px;background:var(--pt-surface-soft);padding:0 14px}
  .search-icon{color:var(--pt-violet);display:grid;place-items:center}
  .search-row input{flex:1;background:none;outline:none;border:0;color:var(--pt-ink);font-size:15px;min-width:0}
  .search-row input::placeholder{color:var(--pt-tertiary)}.search-row>span:last-child{font-size:11px;font-weight:650;color:var(--pt-tertiary);white-space:nowrap}
  .file-list{display:grid;gap:4px;padding:12px 15px 20px}
  .file-item{display:flex;align-items:center;gap:13px;border:1px solid transparent;border-radius:14px;background:none;min-height:65px;width:100%;padding:9px 13px;text-align:left;color:var(--pt-ink)}
  .file-item:hover:not(:disabled),.file-item.file-selected{background:var(--pt-violet-soft);border-color:rgba(98,89,234,.11)}
  .file-glyph{display:grid;place-items:center;flex:none;height:42px;width:42px;border-radius:13px;background:var(--pt-surface-soft);color:var(--pt-secondary)}
  .file-glyph.folder{background:#e6f1ff;color:#4e7bdb}
  .file-details{flex:1;min-width:0;display:grid;gap:4px}.file-details strong{font-size:13px;font-weight:720;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.file-details small{font-size:11px;color:var(--pt-secondary)}
  .file-open{color:var(--pt-tertiary);font-size:19px}.back-folder{background:none;color:var(--pt-violet);margin:0 20px;min-height:42px;padding:0 9px;border-radius:10px;font-size:11px;font-weight:750}.back-folder:hover{background:var(--pt-violet-soft)}
  .empty{padding:62px 22px;display:flex;flex-direction:column;align-items:center;text-align:center}
  .empty-icon{font-size:40px;color:var(--pt-violet);display:grid;place-items:center;width:75px;height:75px;border-radius:23px;background:var(--pt-violet-soft);margin-bottom:20px}
  .empty strong{font-size:19px;font-weight:750}.empty p{max-width:475px;font-size:13px;color:var(--pt-secondary);line-height:1.75}
  .config-note{padding:13px;background:var(--pt-surface-soft);border:1px solid var(--pt-line);border-radius:12px;color:var(--pt-secondary);max-width:100%;overflow-wrap:anywhere;font-size:11px}
  .pending,.no-items{padding:30px;font-size:12px;color:var(--pt-secondary);text-align:center}
  .error-msg{margin:13px 20px;padding:13px;background:#fff0ee;border:1px solid #f7d5ce;border-radius:12px;color:#a9473b;font-size:12px}
  .limit{padding:13px 22px;background:var(--pt-surface-soft);color:var(--pt-secondary);border-top:1px solid var(--pt-line);font-size:11px}
  .detail{display:grid;grid-template-columns:1fr auto;gap:7px;margin-top:16px;padding:22px;border:1px solid var(--pt-line);border-radius:20px;background:var(--pt-surface);box-shadow:var(--pt-shadow-small)}
  .detail span{font-size:10px;color:var(--pt-violet);font-weight:770;letter-spacing:1px}.detail h3{font-size:19px;letter-spacing:-.5px;margin:7px 0}.detail p{font-size:12px;color:var(--pt-secondary);overflow-wrap:anywhere}
  .detail button{width:38px;height:38px;background:var(--pt-surface-soft);color:var(--pt-secondary);border-radius:10px}
  .detail-foot{border-top:1px solid var(--pt-line);padding-top:12px;margin-top:8px;grid-column:1/-1;font-size:12px;color:var(--pt-secondary);line-height:1.6}
  .privacy-note{display:flex;gap:12px;align-items:start;color:var(--pt-secondary);font-size:11px;line-height:1.75;margin-top:22px}
  .privacy-note :global(svg){color:var(--pt-violet);flex:none}
  code{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:var(--pt-violet)}
  @media(max-width:720px){
    .files{padding:25px 18px 127px}.files-header{display:block;margin-bottom:20px}.files-header h1{font-size:34px;margin:12px 0 8px}.files-header p{font-size:12px;line-height:1.6}
    .readonly{margin-top:15px;font-size:9px;padding:9px 12px}
    .files-panel{border-radius:20px}
    .files-toolbar{padding:15px;gap:9px}
    .folder-chooser label{font-size:9px}.folder-chooser select{font-size:12px}
    .refresh span{display:none}
    .breadcrumbs{padding:14px 15px 4px;gap:4px}
    .breadcrumbs button{max-width:130px}.search-row{margin:8px 12px 6px}
    .file-list{padding:7px 9px 12px}.file-item{padding:8px;gap:9px;min-height:61px}
    .file-glyph{width:39px;height:39px}
    .file-details strong{font-size:12px}.file-details small{font-size:10px}.empty{padding:40px 18px}
  }
</style>