import { put } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { hasAdminPermission, hasValidAdminRequest, isAdminConfigured, isSameOriginAdminMutation } from "../../../../../lib/admin-auth";

export const dynamic = "force-dynamic";

const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_BYTES = 5 * 1024 * 1024;

function json(payload: object, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "private, no-store" } });
}

function safeFileName(value: string) {
  const extension = value.toLowerCase().match(/\.(jpe?g|png|webp|gif)$/)?.[1] ?? "image";
  return `campaign-images/${crypto.randomUUID()}.${extension === "jpeg" ? "jpg" : extension}`;
}

export async function POST(request: NextRequest) {
  if (!isAdminConfigured()) return json({ outcome: "admin_not_configured" }, 503);
  if (!hasValidAdminRequest(request)) return json({ outcome: "unauthorized" }, 401);
  if (!hasAdminPermission(request, "marketing:write")) return json({ outcome: "forbidden" }, 403);
  if (!isSameOriginAdminMutation(request)) return json({ outcome: "invalid_origin" }, 403);

  try {
    const data = await request.formData();
    const image = data.get("image");
    if (!(image instanceof File) || !ACCEPTED_TYPES.has(image.type) || image.size < 1 || image.size > MAX_BYTES) {
      return json({ outcome: "invalid_image" }, 400);
    }
    const uploaded = await put(safeFileName(image.name), image, {
      access: "public",
      addRandomSuffix: false,
      contentType: image.type,
    });
    return json({ outcome: "ok", url: uploaded.url });
  } catch (error) {
    console.error("Campaign image upload failed.", error);
    return json({ outcome: "upload_failed" }, 503);
  }
}
