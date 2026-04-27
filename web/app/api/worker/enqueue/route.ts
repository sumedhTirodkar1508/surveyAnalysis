import { NextRequest, NextResponse } from "next/server";
import { enqueueJob } from "@/lib/queue";

/** Verify the shared secret that the Python worker sends. */
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.WORKER_CALLBACK_SECRET;
  if (!secret) {
    console.error("WORKER_CALLBACK_SECRET is not set — rejecting all worker requests.");
    return false;
  }
  const authHeader = req.headers.get("authorization");
  return authHeader === `Bearer ${secret}`;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { jobs } = await req.json();

    if (!jobs || !Array.isArray(jobs)) {
      return NextResponse.json({ error: "Invalid jobs array" }, { status: 400 });
    }

    console.log(`Worker Enqueue: Received ${jobs.length} jobs to process`);

    for (const job of jobs) {
      if (!job.name || !job.data) {
        console.warn("Skipping invalid job:", job);
        continue;
      }
      await enqueueJob(job.name, job.data);
    }

    return NextResponse.json({ success: true, count: jobs.length });
  } catch (error: any) {
    console.error("Worker Enqueue API Error:", error);
    return NextResponse.json(
      { error: "Failed to enqueue jobs", details: error.message },
      { status: 500 }
    );
  }
}
