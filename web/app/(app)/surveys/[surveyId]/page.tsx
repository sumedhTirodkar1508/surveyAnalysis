import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowLeft, Settings, FileBox } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"; // Need to install tabs

export default async function SurveyDetailPage({
  params,
}: {
  params: { surveyId: string };
}) {
  const { surveyId } = await params;
  
  const survey = await prisma.survey.findUnique({
    where: { id: surveyId },
    include: {
      versions: true,
      batches: {
        orderBy: { createdAt: "desc" }
      }
    }
  });

  if (!survey) {
    notFound();
  }

  const activeVersion = survey.versions.find(v => v.isActive);
  const draftVersion = survey.versions.find(v => !v.isActive);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/surveys">
          <Button variant="outline" size="icon">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{survey.title}</h1>
          {survey.description && (
            <p className="text-neutral-500 mt-1">{survey.description}</p>
          )}
        </div>
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="template">Template</TabsTrigger>
          <TabsTrigger value="batches">Batches</TabsTrigger>
          <TabsTrigger value="exports">Exports</TabsTrigger>
        </TabsList>
        
        <TabsContent value="overview" className="space-y-4 pt-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white p-6 border rounded-lg shadow-sm">
              <h3 className="text-sm font-medium text-neutral-500">Status</h3>
              <p className="mt-2 text-2xl font-bold">{survey.status}</p>
            </div>
            <div className="bg-white p-6 border rounded-lg shadow-sm">
              <h3 className="text-sm font-medium text-neutral-500">Total Batches</h3>
              <p className="mt-2 text-2xl font-bold">{survey.batches.length}</p>
            </div>
            <div className="bg-white p-6 border rounded-lg shadow-sm">
              <h3 className="text-sm font-medium text-neutral-500">Active Version</h3>
              <p className="mt-2 text-2xl font-bold">
                {activeVersion ? `v${activeVersion.versionNumber}` : "None"}
              </p>
            </div>
          </div>
        </TabsContent>
        
        <TabsContent value="template" className="pt-4 space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">Survey Template</h2>
            <Link href={`/surveys/${survey.id}/template`}>
              <Button variant="outline">
                <Settings className="w-4 h-4 mr-2" />
                Manage Template
              </Button>
            </Link>
          </div>
          <div className="bg-white border rounded-lg p-8 text-center text-neutral-500">
            {activeVersion ? "Template is configured." : "No active template. Go to Manage Template to set one up."}
          </div>
        </TabsContent>
        
        <TabsContent value="batches" className="pt-4 space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">Processing Batches</h2>
            <Link href={`/surveys/${survey.id}/batches/new`}>
              <Button>
                <FileBox className="w-4 h-4 mr-2" />
                Upload Scans
              </Button>
            </Link>
          </div>
          {survey.batches.length === 0 ? (
            <div className="bg-white border rounded-lg p-8 text-center text-neutral-500">
              No batches uploaded yet.
            </div>
          ) : (
            <div className="bg-white border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 border-b">
                  <tr>
                    <th className="text-left px-6 py-3 font-medium text-neutral-500">Name</th>
                    <th className="text-left px-6 py-3 font-medium text-neutral-500">Status</th>
                    <th className="text-left px-6 py-3 font-medium text-neutral-500">Uploaded</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {survey.batches.map((b) => (
                    <tr key={b.id} className="hover:bg-neutral-50">
                      <td className="px-6 py-4">
                        <Link href={`/surveys/${surveyId}/batches/${b.id}`} className="text-blue-600 hover:underline font-medium">
                          {b.batchName}
                        </Link>
                      </td>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-neutral-100 text-neutral-800">
                          {b.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-neutral-500 text-xs">
                        {new Date(b.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
        
        <TabsContent value="exports" className="pt-4">
          <div className="bg-white border rounded-lg p-8 text-center text-neutral-500">
            Export data features coming soon.
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
