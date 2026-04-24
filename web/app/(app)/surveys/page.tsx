import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import Link from "next/link";
import { listSurveys } from "@/_actions/surveys";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default async function SurveysPage() {
  const surveys = await listSurveys();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Surveys</h1>
        <Link href="/surveys/new">
          <Button>
            <Plus className="w-4 h-4 mr-2" />
            New Survey
          </Button>
        </Link>
      </div>
      
      {surveys.length === 0 ? (
        <div className="bg-white border rounded-lg p-8 text-center text-neutral-500">
          No surveys found. Create your first survey to get started.
        </div>
      ) : (
        <div className="bg-white border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Batches</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {surveys.map((survey) => (
                <TableRow key={survey.id}>
                  <TableCell className="font-medium">
                    <Link href={`/surveys/${survey.id}`} className="text-blue-600 hover:underline">
                      {survey.title}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-neutral-100 text-neutral-800">
                      {survey.status}
                    </span>
                  </TableCell>
                  <TableCell>{survey._count.batches}</TableCell>
                  <TableCell className="text-neutral-500 text-sm">
                    {new Date(survey.createdAt).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
