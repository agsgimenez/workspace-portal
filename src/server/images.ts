import { open, stat } from "node:fs/promises";
import path from "node:path";
import { PortalError } from "./errors.js";
import type { PathPolicy } from "./policy.js";

const IMAGE_MIME_TYPES = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
]);

export interface ImageInfo {
  absolute: string;
  mimeType: string;
  size: number;
}

export function isImageExtension(filePath: string): boolean {
  return IMAGE_MIME_TYPES.has(path.posix.extname(filePath).toLowerCase());
}

export function validatedImageMimeType(filePath: string, header: Buffer): string {
  const extension = path.posix.extname(filePath).toLowerCase();
  const mimeType = IMAGE_MIME_TYPES.get(extension);
  if (!mimeType) throw new PortalError("Image type is not supported", 415, "PREVIEW_DENIED");

  const png = header.length >= 8 && header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpeg = header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  const webp = header.length >= 12 && header.toString("ascii", 0, 4) === "RIFF" && header.toString("ascii", 8, 12) === "WEBP";
  const signatureMatches = extension === ".png" ? png : extension === ".webp" ? webp : jpeg;

  if (!signatureMatches) throw new PortalError("Image signature does not match its extension", 415, "INVALID_IMAGE");
  return mimeType;
}

export async function inspectImage(policy: PathPolicy, input: unknown): Promise<ImageInfo> {
  const target = await policy.resolve(input, "file");
  if (!isImageExtension(target.relative)) throw new PortalError("Raw preview is not available for this file type", 415, "PREVIEW_DENIED");

  const fileStats = await stat(target.absolute);
  if (fileStats.size > policy.config.maxImageBytes) {
    throw new PortalError("Image exceeds the preview limit", 413, "FILE_TOO_LARGE");
  }

  const file = await open(target.absolute, "r");
  const header = Buffer.alloc(12);
  let bytesRead: number;
  try {
    ({ bytesRead } = await file.read(header, 0, header.length, 0));
  } finally {
    await file.close();
  }

  return {
    absolute: target.absolute,
    mimeType: validatedImageMimeType(target.relative, header.subarray(0, bytesRead)),
    size: fileStats.size,
  };
}
