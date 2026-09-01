import React, { useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Paperclip, Trash2, Download, Upload, FileImage, FileText, File, X, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { protectedFetch } from "@/lib/auth-scope";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

interface Attachment {
  id: number;
  entityType: string;
  entityId: number;
  objectPath: string;
  fileName: string;
  fileType: string;
  fileSize: number | null;
  description: string | null;
  uploadedBy: string | null;
  createdAt: string;
}

interface FilesTabProps {
  entityType: "customer" | "lead";
  entityId: number;
}

function fileIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) return <FileImage className="w-5 h-5 text-blue-500" />;
  if (mimeType === "application/pdf") return <FileText className="w-5 h-5 text-red-500" />;
  return <File className="w-5 h-5 text-slate-400" />;
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function FilesTab({ entityType, entityId }: FilesTabProps) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

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
        body: JSON.stringify({ entityType, entityId, objectPath, fileName: file.name, fileType: file.type || "application/octet-stream", fileSize: file.size }),
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
  }, [entityType, entityId, qc]);

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    Array.from(files).forEach(uploadFile);
  }, [uploadFile]);

  const attachments = data?.attachments ?? [];

  return (
    <div className="space-y-4">
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
          onChange={e => handleFiles(e.target.files)}
          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
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
            <p className="text-xs">Images, PDFs, documents up to 20MB</p>
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

      {/* File list */}
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
        <div className="space-y-2">
          {attachments.map(att => (
            <div key={att.id} className="flex items-center gap-3 p-3 bg-white border border-slate-100 rounded-xl hover:border-slate-200 transition group">
              {fileIcon(att.fileType)}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">{att.fileName}</p>
                <p className="text-xs text-slate-400">
                  {formatBytes(att.fileSize)}
                  {att.uploadedBy ? ` · ${att.uploadedBy}` : ""}
                  {" · "}
                  {format(new Date(att.createdAt), "MMM d, yyyy")}
                </p>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                <a
                  href={`${BASE}/api/storage/objects${att.objectPath.replace(/^\/objects/, "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-700"
                  title="Download"
                  onClick={e => e.stopPropagation()}
                >
                  <Download className="w-4 h-4" />
                </a>
                <button
                  className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600"
                  title="Delete"
                  onClick={() => {
                    if (window.confirm(`Delete "${att.fileName}"?`)) {
                      deleteMutation.mutate(att.id);
                    }
                  }}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
