<script lang="ts">
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
    <span class="readonly">◉ READ-ONLY INVENTORY</span>
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
      <button class="refresh" onclick={refresh} disabled={!connected} aria-label="Refresh folder listing">↻ <span>Refresh</span></button>
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
        <button onclick={() => navigate('')} disabled={!folder} aria-label="Go to folder root">⌂ {activeRoot?.label ?? 'Folder'}</button>
        {#each folder.split('/').filter(Boolean) as segment, index}
          <span>›</span>
          <button onclick={() => navigate(folder.split('/').slice(0, index + 1).join('/'))}>{segment}</button>
        {/each}
      </div>
      <div class="search-row">
        <span class="search-icon">⌕</span>
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
              <span class="file-glyph" class:folder={e.kind === 'directory'}>{e.kind === 'directory' ? '▤' : e.kind === 'symlink' ? '↗' : '▧'}</span>
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

  <footer class="privacy-note">⌕ <span>Pocket-T lists only the folder metadata you specifically authorise on the Mac. Hidden files, symlink traversal, and file-content transfer are off by default.</span></footer>
</section>

<style>
  .files{flex:1;overflow-y:auto;padding:35px clamp(18px,4.5vw,70px) 60px;max-width:1320px;width:100%;margin:auto}
  .files-header{display:flex;align-items:start;justify-content:space-between;gap:12px;margin-bottom:31px}
  .eyebrow{font-size:10px;color:#7fabb0;letter-spacing:1.6px;font-weight:850}.eyebrow span{margin:0 8px;color:#557179}
  .files-header h1{font-size:35px;letter-spacing:-1.4px;margin:12px 0;font-weight:680}.files-header h1 span{color:#a2eacb}
  .files-header p{max-width:550px;color:#8fa7ae;line-height:1.7;font-size:12px;margin:0}
  .readonly{border:1px solid #3f6051;background:#1b3530;color:#9ee6c5;font-size:9px;letter-spacing:1px;border-radius:8px;padding:10px;white-space:nowrap}
  .files-panel{border:1px solid #294343;background:#101e28;border-radius:17px;overflow:hidden}
  .files-toolbar{padding:19px 21px;display:flex;align-items:end;justify-content:space-between;gap:10px;background:#162932}
  .folder-chooser{display:grid;gap:7px;max-width:370px;width:100%}.folder-chooser label{font-size:9px;color:#8da7a7;letter-spacing:1.2px;font-weight:800}
  .folder-chooser select{color:#daf1e8;background:#223940;border:1px solid #36544f;border-radius:9px;padding:11px 35px 11px 11px;font-size:13px;width:100%}
  .refresh{background:#213a35;border:1px solid #3c5e53;color:#adebd0;border-radius:9px;padding:10px 13px;font-size:12px;white-space:nowrap}
  button:disabled{opacity:.45;cursor:not-allowed}.refresh:hover:not(:disabled){background:#2f5346}
  .breadcrumbs{padding:15px 21px 5px;display:flex;align-items:center;flex-wrap:wrap;gap:7px;min-height:49px}
  .breadcrumbs button{color:#b5edcf;background:none;border:0;padding:5px 1px;font-size:12px;max-width:230px;text-overflow:ellipsis;overflow:hidden;white-space:nowrap}
  .breadcrumbs button:disabled{color:#99b7b3;opacity:1}.breadcrumbs span{color:#56767a}
  .search-row{margin:12px 21px 7px;display:flex;align-items:center;gap:9px;background:#142b31;border:1px solid #2b4346;border-radius:11px;padding:11px 12px}
  .search-icon{font-size:18px;color:#97d8bc}
  .search-row input{flex:1;min-width:0;background:none;border:0;outline:0;color:#eaf7f1;font:inherit;font-size:13px}.search-row input::placeholder{color:#668389}
  .search-row>span:last-child{white-space:nowrap;font-size:10px;color:#779d97}
  .file-list{padding:10px 20px 22px;display:grid;gap:4px}
  .file-item{display:flex;width:100%;align-items:center;gap:12px;text-align:left;padding:12px 10px;border:1px solid transparent;border-radius:11px;background:none}
  .file-item:hover:not(:disabled),.file-item.file-selected{border-color:#335a50;background:#1c3837}
  .file-glyph{display:grid;place-items:center;flex:none;width:38px;height:38px;color:#8bafc0;background:#223743;font-size:19px;border-radius:11px}.file-glyph.folder{background:#24493e;color:#a1f0c8}
  .file-details{display:grid;gap:4px;min-width:0;flex:1}.file-details strong{overflow-wrap:anywhere;font-size:12px;font-weight:680;color:#e1f0ed}.file-details small{color:#79959e;font-size:10px}
  .file-open{font-size:20px;color:#719b90}.back-folder{padding:10px 29px;border:0;background:none;color:#a6e6c9;font-size:11px}
  .empty{display:flex;flex-direction:column;align-items:center;text-align:center;padding:45px 24px}
  .empty-icon{font-size:36px;color:#a9edcb;margin-bottom:13px}
  .empty strong{font-size:17px}.empty p{font-size:12px;color:#92aab0;line-height:1.8;max-width:490px;margin:12px 0}
  .config-note{padding:12px;border:1px solid #385650;border-radius:8px;background:#1b3035;font-size:11px;color:#b9e9d6;max-width:100%;overflow-wrap:anywhere}
  .no-items,.pending{padding:25px;color:#8da9a6;text-align:center;font-size:12px}.error-msg{margin:14px 20px;padding:12px;border:1px solid #815154;border-radius:9px;color:#fac7c7;font-size:12px;background:#3b2227}
  .limit{font-size:11px;padding:15px 22px;color:#b7ab85;border-top:1px solid #2d4041}
  .detail{margin-top:18px;padding:20px;background:#1b3432;border:1px solid #3a6556;border-radius:14px;display:grid;grid-template-columns:1fr auto;gap:9px}
  .detail span{font-size:9px;color:#80bba8;letter-spacing:1.4px;font-weight:850}.detail h3{font-size:17px;margin:8px 0}.detail p{font-size:11px;color:#a6bec0;overflow-wrap:anywhere}.detail button{align-self:start;background:none;border:0;color:#add7c6}
  .detail-foot{grid-column:1/-1;font-size:11px;line-height:1.6;color:#8da7a0;border-top:1px solid #31534a;padding-top:12px}
  .privacy-note{display:flex;gap:12px;margin-top:19px;color:#849fa5;font-size:11px;line-height:1.7}.privacy-note>span{flex:1}
  code{color:#c5e9db;font-family:ui-monospace,Menlo,monospace}
  @media(max-width:760px){
    .files{padding:24px 16px 35px}.files-header{display:block;margin-bottom:20px}.files-header h1{font-size:31px}.files-header p{font-size:12px}
    .readonly{display:inline-flex;margin-top:13px;font-size:8px;padding:7px}
    .files-toolbar{padding:15px}.folder-chooser{max-width:unset}.refresh span{display:none}
    .search-row{margin:10px 12px}.file-list{padding:7px 10px 15px}.file-item{padding:10px 8px}
    .breadcrumbs{padding:12px 13px 2px}.breadcrumbs button{max-width:135px}.search-row>span:last-child{font-size:9px}
    .empty{padding:32px 16px}.config-note{font-size:10px}
  }

  /* Light, Finder-inspired Pocket Studio skin — permission logic unchanged. */
  .files{color:#292942;background:transparent}
  .eyebrow{color:#8c7bbe}.files-header h1{color:#292740}.files-header h1 span{color:#8269df}.files-header p{color:#8e91a5}
  .readonly{color:#7763cf;background:#efebff;border-color:#e0d9fd}
  .files-panel{background:#fff;border:1px solid #e9e8f3;border-radius:23px;box-shadow:0 16px 36px #34365a0c}
  .files-toolbar{background:#f9f8ff;border-bottom:1px solid #edebf6}
  .folder-chooser label{color:#9a97b0}
  .folder-chooser select{background:#fff;border-color:#e4e0f1;color:#38334d;min-height:44px;font-size:14px}
  .refresh{min-width:44px;min-height:44px;background:#eeeaff;color:#7a61d8;border-color:#e2ddf8}
  .breadcrumbs button{color:#7964d6;min-height:40px}.breadcrumbs button:disabled{color:#847e99}
  .breadcrumbs span{color:#b9b4c9}
  .search-row{background:#f7f6fc;border-color:#e6e3f0;min-height:49px}.search-icon{color:#8c79de}
  .search-row input{color:#343047;font-size:16px}.search-row input::placeholder{color:#aaa5bb}
  .search-row>span:last-child{color:#a4a0b4}
  .file-item{min-height:59px;transition:background .18s,transform .18s}
  .file-item:hover:not(:disabled),.file-item.file-selected{background:#f6f2ff;border-color:#ede4ff}
  .file-glyph{background:#ebecfa;color:#808abf}.file-glyph.folder{background:#f0ebff;color:#846bdc}
  .file-details strong{color:#35324c;font-size:13px}.file-details small{color:#9493a8}
  .file-open{color:#9990bd}.back-folder{color:#7d65d8;min-height:44px}
  .empty strong{color:#343047}.empty p{color:#89889f}.empty-icon{color:#7f67d9}
  .config-note{background:#f2f0fc;border-color:#e1dff0;color:#665c92}
  .error-msg{background:#fff0f2;border-color:#f4d6dd;color:#b45c71}
  .no-items,.pending{color:#9994ab}.limit{color:#a49376;border-color:#eee9df}
  .detail{background:#f1edff;border-color:#e0d7fc}.detail h3{color:#38324e}.detail p{color:#908ba6}.detail span{color:#7961d1}
  .detail button{color:#826acb}.detail-foot{color:#817d9a;border-color:#e0daf2}
  .privacy-note{color:#9695a6}
  code{color:#6650b4}
  @media(hover:none){.file-item:hover:not(:disabled){background:transparent}}

</style>
