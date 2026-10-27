/**
 * A logo, ready for the server — phase 8. Whatever was chosen (PNG, JPEG, WebP)
 * is drawn at its own proportions, at most 600 × 200, on white (a transparent
 * background prints white on a PDF), and sent as a JPEG.
 */
export const LOGO_MAX = { width: 600, height: 200 };

/** The size a logo is drawn at: its own proportions, never larger than the box or than it is. */
export function logoSize(width: number, height: number, max = LOGO_MAX) {
  const scale = Math.min(max.width / width, max.height / height, 1);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export async function logoToJpeg(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file (PNG or JPEG)");
  if (file.size > 10 * 1024 * 1024) throw new Error("That image is too large; use one under 10 MB");
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("That file could not be read as an image"));
      img.src = url;
    });
    const size = logoSize(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot prepare the image");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(image, 0, 0, size.width, size.height);
    return canvas.toDataURL("image/jpeg", 0.92);
  } finally {
    URL.revokeObjectURL(url);
  }
}
