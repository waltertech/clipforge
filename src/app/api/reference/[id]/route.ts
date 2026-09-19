import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { isReferenceId, publicizeJob, readJob } from "@/lib/reference/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/reference/[id] — job JSON with frame paths rewritten to /api/files/reference/<id>/frames/<file> */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isReferenceId(id)) {
    return apiError(req, "对标任务不存在", "Reference job not found", 404);
  }
  const job = await readJob(id);
  if (!job) {
    return apiError(req, "对标任务不存在", "Reference job not found", 404);
  }
  return NextResponse.json(publicizeJob(job));
}
