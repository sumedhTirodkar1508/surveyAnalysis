import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import Link from "next/link";

export default function SurveysPage() {
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
      
      <div className="bg-white border rounded-lg p-8 text-center text-neutral-500">
        No surveys found. Create your first survey to get started.
      </div>
    </div>
  );
}
