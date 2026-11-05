<script lang="ts">
  import { date } from './data.js';
  import * as Table from './components/ui/table/index.js';
  import { Button } from './components/ui/button/index.js';
  import { Input } from './components/ui/input/index.js';
  import EmptyState from './EmptyState.svelte';
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
{#if canUpload}<label class="mb-4 grid gap-2 text-sm">Upload a file<Input aria-label="Upload a file" type="file" disabled={busy} onchange={onupload} /></label>{/if}
{#if !files?.rows.length}<EmptyState description="No files found." />
{:else}<div class="max-w-full overflow-x-auto rounded-lg border"><Table.Root><Table.Header><Table.Row><Table.Head>File</Table.Head><Table.Head>Status</Table.Head><Table.Head>Owner</Table.Head><Table.Head>Size</Table.Head><Table.Head>Uploaded</Table.Head><Table.Head>Actions</Table.Head></Table.Row></Table.Header><Table.Body>
  {#each files.rows as file}<Table.Row><Table.Cell>{file.filename}<div class="help">{file.contentType} · {file.id.slice(0, 8)}</div></Table.Cell><Table.Cell>{file.status}</Table.Cell><Table.Cell>{file.ownerId}</Table.Cell><Table.Cell>{file.size.toLocaleString()} bytes</Table.Cell><Table.Cell>{date(file.uploadedAt ?? file.createdAt)}</Table.Cell><Table.Cell>{#if canDownload}<Button size="sm" variant="outline" onclick={() => ondownload(file.id, file.filename)}>Download</Button>{/if}{#if canDelete}<Button size="sm" variant="destructive" disabled={busy} onclick={() => onremove(file.id)}>Delete</Button>{/if}</Table.Cell></Table.Row>{/each}
</Table.Body></Table.Root></div>{/if}
