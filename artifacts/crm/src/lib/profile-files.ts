/**
 * A profile's photos and files, by location — phase 3, Kyle's Videos 4 and 5:
 * photos, documents and videos "organised by job location", and photos that
 * keep "the same resolution and the same size" — nothing is resized or
 * squished; the original file is what is shown and what is downloaded.
 */
export interface FileLocation { id: number; label: string }
export interface ProfileFile { id: number; propertyId?: number | null; fileType: string }
export interface FileGroup<T> { key: string; location: FileLocation | null; files: T[] }

export type FileKind = "image" | "video" | "pdf" | "other";
export const fileKind = (mimeType: string): FileKind =>
  mimeType.startsWith("image/") ? "image"
    : mimeType.startsWith("video/") ? "video"
      : mimeType === "application/pdf" ? "pdf" : "other";

/** A location by its own name, else its street, as on the estimate cards. */
export const locationLabel = (property: { name?: string | null; address: string }) => property.name?.trim() || property.address;

/** Where a new upload goes: the one location, else the first (the primary); none without locations. */
export const defaultUploadLocation = (locations: FileLocation[]): number | null => locations[0]?.id ?? null;

/**
 * Files under their locations, in the profile's own order, then those for the
 * profile as a whole — including any whose location has since gone. Only
 * groups with files.
 */
export function groupFilesByLocation<T extends ProfileFile>(files: T[], locations: FileLocation[]): FileGroup<T>[] {
  const known = new Set(locations.map((location) => location.id));
  const groups: FileGroup<T>[] = locations.map((location) => ({
    key: `location-${location.id}`, location, files: files.filter((file) => file.propertyId === location.id),
  }));
  groups.push({ key: "profile", location: null, files: files.filter((file) => file.propertyId == null || !known.has(file.propertyId)) });
  return groups.filter((group) => group.files.length > 0);
}

/** The original file, as uploaded. */
export const fileUrl = (base: string, objectPath: string) => `${base}/api/storage/objects${objectPath.replace(/^\/objects/, "")}`;
