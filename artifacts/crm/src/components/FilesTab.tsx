import React, { useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Paperclip, Trash2, Download, Upload, FileText, File, X, Loader2, MapPin, Play, ExternalLink } from "lucide-react";
import { format } from "date-fns";
import { protectedFetch } from "@/lib/auth-scope";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { defaultUploadLocation, fileKind, fileUrl, groupFilesByLocation, type FileLocation } from "@/lib/profile-files";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

interface Attachment {
  id: number;
  entityType: string;
  entityId: number;
  objectPath: string;
  fileName: string;
  fileType: string;
  fileSize: number | null;
  propertyId?: number | null;
  description: string | null;
  uploadedBy: string | null;
  createdAt: string;
}

interface FilesTabProps {
  entityType: "customer" | "lead";
  entityId: number;
  /** The profile's locations, primary first — phase 3 files photos and files under them. */
  locations?: FileLocation[];
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * The tile's picture. Kyle (Video 5): photos must not be squished — the
 * original is shown whole inside the tile (`object-contain`), never cropped
 * or stretched, and never resized on upload.
 */
function Preview({ att }: { att: Attachment }) {
  const [broken, setBroken] = useState(false);
  const kind = fileKind(att.fileType);
  const src = fileUrl(BASE, att.objectPath);
  if (kind === "image" && !broken) {
    return <img src={src} alt={att.fileName} loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-contain" />;
  }
  if (kind === "video" && !broken) {
    return (
      <>
        <video src={`${src}#t=0.1`} preload="metadata" muted playsInline onError={() => setBroken(true)} className="h-full w-full object-contain" />
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-white"><Play className="h-5 w-5 translate-x-px" /></span>
        </span>
      </>
    );
  }
  return kind === "pdf"
    ? <FileText className="h-10 w-10 text-red-500" />
    : <File className="h-10 w-10 text-slate-400" />;
}

export function FilesTab({ entityType, entityId, locations = [] }: FilesTabProps) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploadLocation, setUploadLocation] = useState<number | null>(() => defaultUploadLocation(locations));
  const [viewingId, setViewingId] = useState<number | null>(null);

  const { data, isLoading } = useQuery<{ attachments: Attachment[] }>({
    queryKey: ["/api/attachments", entityType, entityId],
    queryFn: async () => {
      const response = await protectedFetch(`${BASE}/api/attachments?entityType=${entityType}&entityId=${entityId}`);
      if (!response.ok) throw new Error(`Failed to load attachments (${response.status})`);
      return response.json();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await protectedFetch(`${BASE}/api/attachments/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(`Failed to delete attachment (${response.status})`);
      return response.json();
    },
    onSuccess: () => { setViewingId(null); return qc.invalidateQueries({ queryKey: ["/api/attachments", entityType, entityId] }); },
  });

  const moveMutation = useMutation({
    mutationFn: async ({ id, propertyId }: { id: number; propertyId: number | null }) => {
      const response = await protectedFetch(`${BASE}/api/attachments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Failed to move the file (${response.status})`);
      return body;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/attachments", entityType, entityId] }),
  });

  const uploadFile = useCallback(async (file: File) => {
    setUploading(true);
    setError(null);
    setUploadProgress(`Requesting upload URL…`);

    try {
      // Step 1: get presigned upload URL
      const urlRes = await protectedFetch(`${BASE}/api/storage/uploads/request-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type || "application/octet-stream" }),
      });
      if (!urlRes.ok) throw new Error("Failed to get upload URL");
      const { uploadURL, objectPath } = await urlRes.json();

      // Public presigned GCS URL: deliberately unauthenticated and outside
      // /api; protected API steps before/after it use protectedFetch.
      // The file goes up exactly as it is: same resolution, same size.
      setUploadProgress(`Uploading ${file.name}…`);
      const putRes = await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!putRes.ok) throw new Error(`Upload failed: ${putRes.statusText}`);

      // Step 3: register the attachment in our DB
      setUploadProgress(`Saving record…`);
      const regRes = await protectedFetch(`${BASE}/api/attachments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          entityType, entityId, objectPath, fileName: file.name, fileType: file.type || "application/octet-stream", fileSize: file.size,
          propertyId: uploadLocation,
        }),
      });
      if (!regRes.ok) throw new Error("Failed to save attachment record");

      qc.invalidateQueries({ queryKey: ["/api/attachments", entityType, entityId] });
      setUploadProgress(null);
    } catch (e: any) {
      setError(e.message || "Upload failed");
      setUploadProgress(null);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }, [entityType, entityId, uploadLocation, qc]);

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    Array.from(files).forEach(uploadFile);
  }, [uploadFile]);

  const attachments = data?.attachments ?? [];
  const groups = groupFilesByLocation(attachments, locations);
  const viewing = attachments.find((att) => att.id === viewingId) ?? null;
  const viewingKind = viewing ? fileKind(viewing.fileType) : null;

  return (
    <div className="space-y-4" data-testid="files-tab">
      {entityType === "customer" && <CorsteadDocuments customerId={entityId} />}
      {locations.length > 0 && (
        <label className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
          <MapPin className="h-4 w-4 text-slate-400" />
          <span className="font-medium">Upload to</span>
          <select data-testid="files-location-picker" value={uploadLocation ?? ""} disabled={uploading}
            onChange={(e) => setUploadLocation(e.target.value ? Number(e.target.value) : null)}
            className="h-9 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-sm sm:flex-none">
            {locations.map((location) => <option key={location.id} value={location.id}>{location.label}</option>)}
            <option value="">The whole profile (no one location)</option>
          </select>
        </label>
      )}

      {/* Upload zone */}
      <div
        className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
          dragOver ? "border-primary bg-primary/5" : "border-slate-200 hover:border-primary/50"
        }`}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
        onClick={() => !uploading && inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === "Enter" && inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          data-testid="files-input"
          onChange={e => handleFiles(e.target.files)}
          accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
        />
        {uploading ? (
          <div className="flex flex-col items-center gap-2 text-primary">
            <Loader2 className="w-8 h-8 animate-spin" />
            <p className="text-sm font-medium">{uploadProgress}</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-slate-400 cursor-pointer">
            <Upload className="w-8 h-8" />
            <p className="text-sm font-medium text-slate-600">Drop files here or click to browse</p>
            <p className="text-xs">Photos, videos, PDFs and documents, kept at their original size</p>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 text-red-700 rounded-lg px-4 py-3 text-sm">
          <X className="w-4 h-4 flex-shrink-0" />
          {error}
          <button className="ml-auto" onClick={() => setError(null)}><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Files, by location */}
      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
        </div>
      ) : attachments.length === 0 ? (
        <div className="text-center py-8 text-slate-400">
          <Paperclip className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No files uploaded yet</p>
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map((group) => (
            <section key={group.key} data-testid="files-group" data-location={group.location?.id ?? ""}>
              {locations.length > 0 && (
                <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <MapPin className="h-3.5 w-3.5" />
                  {group.location?.label ?? "Whole profile"}
                  <span className="font-normal text-slate-400">· {group.files.length}</span>
                </h4>
              )}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {group.files.map((att) => (
                  <button key={att.id} type="button" data-testid="file-tile" onClick={() => setViewingId(att.id)}
                    className="group overflow-hidden rounded-xl border border-slate-200 bg-white text-left transition hover:border-slate-300 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                    <span className="relative flex aspect-[4/3] items-center justify-center bg-slate-100">
                      <Preview att={att} />
                    </span>
                    <span className="block px-2.5 py-2">
                      <span className="block truncate text-xs font-medium text-slate-800">{att.fileName}</span>
                      <span className="block truncate text-[11px] text-slate-400">
                        {[formatBytes(att.fileSize), att.uploadedBy, format(new Date(att.createdAt), "MMM d, yyyy")].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <Dialog open={viewing != null} onOpenChange={(open) => { if (!open) setViewingId(null); }}>
        <DialogContent className="max-w-5xl max-h-[95vh] overflow-y-auto rounded-2xl" data-testid="file-viewer">
          <DialogHeader><DialogTitle className="truncate pr-6">{viewing?.fileName ?? "File"}</DialogTitle></DialogHeader>
          {viewing && (
            <>
              {/* Shown whole, at its own proportions; never larger than it really is. */}
              <div className="flex items-center justify-center rounded-xl bg-slate-900/95 p-2">
                {viewingKind === "image" && (
                  <img data-testid="file-viewer-image" src={fileUrl(BASE, viewing.objectPath)} alt={viewing.fileName}
                    className="max-h-[60vh] max-w-full object-contain" />
                )}
                {viewingKind === "video" && (
                  <video data-testid="file-viewer-video" src={fileUrl(BASE, viewing.objectPath)} controls playsInline
                    className="max-h-[60vh] max-w-full" />
                )}
                {viewingKind === "pdf" && (
                  <iframe title={viewing.fileName} src={fileUrl(BASE, viewing.objectPath)} className="h-[60vh] w-full rounded-lg bg-white" />
                )}
                {viewingKind === "other" && (
                  <div className="flex flex-col items-center gap-2 py-12 text-slate-300">
                    <File className="h-12 w-12" />
                    <p className="text-sm">No preview for this kind of file — download it to open it.</p>
                  </div>
                )}
              </div>
              <p className="text-xs text-slate-500">
                {[formatBytes(viewing.fileSize), viewing.uploadedBy ? `Uploaded by ${viewing.uploadedBy}` : null, format(new Date(viewing.createdAt), "MMM d, yyyy")].filter(Boolean).join(" · ")}
              </p>
              {locations.length > 0 && (
                <label className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                  <MapPin className="h-4 w-4 text-slate-400" />
                  <span className="font-medium">Location</span>
                  <select data-testid="file-move" value={viewing.propertyId != null && locations.some((l) => l.id === viewing.propertyId) ? viewing.propertyId : ""}
                    disabled={moveMutation.isPending}
                    onChange={(e) => moveMutation.mutate({ id: viewing.id, propertyId: e.target.value ? Number(e.target.value) : null })}
                    className="h-9 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-sm sm:flex-none">
                    {locations.map((location) => <option key={location.id} value={location.id}>{location.label}</option>)}
                    <option value="">The whole profile (no one location)</option>
                  </select>
                  {moveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
                </label>
              )}
              {moveMutation.isError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{(moveMutation.error as Error).message}</p>}
            </>
          )}
          <DialogFooter className="gap-2 sm:justify-between">
            {viewing && (
              <button type="button" data-testid="file-delete" disabled={deleteMutation.isPending}
                onClick={() => { if (window.confirm(`Delete "${viewing.fileName}"?`)) deleteMutation.mutate(viewing.id); }}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-red-200 px-4 text-sm font-semibold text-red-600 hover:bg-red-50">
                <Trash2 className="h-4 w-4" /> Delete
              </button>
            )}
            {viewing && (
              <span className="flex gap-2">
                <a href={fileUrl(BASE, viewing.objectPath)} target="_blank" rel="noopener noreferrer" data-testid="file-open-original"
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50">
                  <ExternalLink className="h-4 w-4" /> Open original
                </a>
                <a href={fileUrl(BASE, viewing.objectPath)} download={viewing.fileName}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-white hover:bg-primary/90">
                  <Download className="h-4 w-4" /> Download
                </a>
              </span>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * A4 (Video 7): the invoices Corstead made for this profile, filed with its
 * documents. Each PDF is drawn when it is opened, so it always shows what is
 * paid and owed now; nothing is copied into storage that could go stale.
 */
function CorsteadDocuments({ customerId }: { customerId: number }) {
  const { data } = useQuery<Array<{ id: number; invoiceNumber: string; totalAmount: number; status: string; createdAt: string }>>({
    queryKey: ["files-invoices", customerId],
    queryFn: async () => {
      const response = await protectedFetch(`${BASE}/api/invoices?customerId=${customerId}`);
      if (!response.ok) return [];
      const body = await response.json();
      return Array.isArray(body) ? body : body.data ?? [];
    },
  });
  if (!data?.length) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white" data-testid="files-invoices">
      <p className="border-b border-slate-100 px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-slate-400">Invoices</p>
      {data.map((invoice) => (
        <a key={invoice.id} href={`${BASE}/api/invoices/${invoice.id}/pdf`} target="_blank" rel="noreferrer" data-testid="files-invoice"
          className="flex items-center justify-between gap-3 border-b border-slate-50 px-4 py-2.5 text-sm last:border-0 hover:bg-slate-50">
          <span className="flex min-w-0 items-center gap-2">
            <FileText className="h-4 w-4 shrink-0 text-red-500" />
            <span className="truncate font-medium text-slate-800">Invoice-{invoice.invoiceNumber}.pdf</span>
          </span>
          <span className="shrink-0 text-xs text-slate-500">
            {formatMoney(Number(invoice.totalAmount))} · {invoice.status.replace(/_/g, " ")} · {format(new Date(invoice.createdAt), "MMM d, yyyy")}
          </span>
        </a>
      ))}
    </div>
  );
}
const formatMoney = (value: number) => `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
