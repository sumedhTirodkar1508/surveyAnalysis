import { prisma } from "@/lib/db";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { User, ExternalLink, Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export const dynamic = "force-dynamic";

export default async function ParticipantsPage() {
  // 1. Fetch all submissions to aggregate participants.
  // We want unique participants (by corrected or extracted name).
  const submissions = await prisma.surveySubmission.findMany({
    orderBy: { batch: { createdAt: "desc" } },
    include: {
      batch: {
        select: {
          surveyId: true,
          createdAt: true,
        },
      },
    },
  });

  // 2. Aggregate unique participants
  const participantsMap = new Map<string, {
    name: string;
    latestConfidence: number | null;
    latestSubmissionId: string;
    surveyId: string;
    batchId: string;
    lastSeen: Date;
  }>();

  for (const sub of submissions) {
    const name = sub.participantNameCorrected || sub.participantNameExtracted || "Anonymous";
    const nameKey = name.toLowerCase().trim();

    if (!participantsMap.has(nameKey)) {
      participantsMap.set(nameKey, {
        name,
        latestConfidence: sub.confidenceScore,
        latestSubmissionId: sub.id,
        surveyId: sub.batch.surveyId,
        batchId: sub.batchId,
        lastSeen: sub.batch.createdAt,
      });
    }
  }

  const participants = Array.from(participantsMap.values()).sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime());

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Participants</h1>
          <p className="text-neutral-500 mt-1">
            Global directory of residents who have completed surveys.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 max-w-sm">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
          <Input placeholder="Search by name..." className="pl-9" />
        </div>
      </div>

      <div className="bg-white border rounded-lg overflow-hidden shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Resident Name</TableHead>
              <TableHead>Tech Confidence</TableHead>
              <TableHead>Last Submission</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {participants.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center text-neutral-500">
                  No participants found.
                </TableCell>
              </TableRow>
            ) : (
              participants.map((p) => (
                <TableRow key={p.name}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-neutral-100 flex items-center justify-center">
                        <User className="w-4 h-4 text-neutral-500" />
                      </div>
                      {p.name}
                    </div>
                  </TableCell>
                  <TableCell>
                    {p.latestConfidence ? (
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-2 bg-neutral-100 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-blue-600 rounded-full" 
                            style={{ width: `${p.latestConfidence * 100}%` }}
                          />
                        </div>
                        <span className="text-xs font-medium">
                          {(p.latestConfidence * 100).toFixed(0)}%
                        </span>
                      </div>
                    ) : (
                      <span className="text-neutral-400">N/A</span>
                    )}
                  </TableCell>
                  <TableCell className="text-neutral-500 text-sm">
                    {p.lastSeen.toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link href={`/surveys/${p.surveyId}/batches/${p.batchId}/review/${p.latestSubmissionId}`}>
                      <Button variant="ghost" size="sm" className="gap-2">
                        <ExternalLink className="w-3.5 h-3.5" />
                        View
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
