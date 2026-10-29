<script lang="ts">
  import { date } from './data.js';
  let { files, canUpload, canDownload, canDelete, busy, error, onupload, ondownload, onremove }: {
    files: { rows: { id: string; ownerId: string; filename: string; contentType: string; size: number; status: string; createdAt: number; uploadedAt: number | null }[]; nextCursor: string | null } | null;
    canUpload: boolean;
    canDownload: boolean;
    canDelete: boolean;
    busy: boolean;
    error: string;
    onupload: (event: Event) => void;
    ondownload: (id: string, filename: string) => void;
    onremove: (id: string) => void;
  } = $props();
</script>

{#if error}<p class="error" role="alert">{error}</p>{/if}
{#if canUpload}<label class="button primary">Upload a file<input aria-label="Upload a file" type="file" hidden disabled={busy} onchange={onupload} /></label>{/if}
{#if !files?.rows.length}<div class="empty">No files found.</div>
{:else}<div class="table-wrap"><table><thead><tr><th>File</th><th>Status</th><th>Owner</th><th>Size</th><th>Uploaded</th><th>Actions</th></tr></thead><tbody>
  {#each files.rows as file}<tr><td>{file.filename}<div class="help">{file.contentType} · {file.id.slice(0, 8)}</div></td><td>{file.status}</td><td>{file.ownerId}</td><td>{file.size.toLocaleString()} bytes</td><td>{date(file.uploadedAt ?? file.createdAt)}</td><td>{#if canDownload}<button class="small" onclick={() => ondownload(file.id, file.filename)}>Download</button>{/if}{#if canDelete}<button class="small" disabled={busy} onclick={() => onremove(file.id)}>Delete</button>{/if}</td></tr>{/each}
</tbody></table></div>{/if}
