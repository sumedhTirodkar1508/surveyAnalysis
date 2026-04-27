"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { activateVersion, deactivateVersion } from "@/_actions/versions";
import { CheckCircle2, Rocket, RotateCcw } from "lucide-react";
import { toast } from "sonner";

interface ActivateVersionButtonProps {
  versionId: string;
  isActive: boolean;
  questionsCount: number;
}

export function ActivateVersionButton({
  versionId,
  isActive,
  questionsCount,
}: ActivateVersionButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleActivate = async () => {
    if (questionsCount === 0) {
      toast.error("Add at least one question before activating.");
      return;
    }
    try {
      setLoading(true);
      await activateVersion(versionId);
      toast.success("Template version activated!");
    } catch (err: any) {
      toast.error(err.message || "Failed to activate version");
    } finally {
      setLoading(false);
    }
  };

  const handleReturnToDraft = async () => {
    try {
      setLoading(true);
      await deactivateVersion(versionId);
      toast.success(
        "Template returned to draft — you can now edit questions. Remember to re-activate when done."
      );
    } catch (err: any) {
      toast.error(err.message || "Failed to return to draft");
    } finally {
      setLoading(false);
    }
  };

  if (isActive) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-md text-green-700 text-sm font-medium">
          <CheckCircle2 className="w-4 h-4" />
          Active
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleReturnToDraft}
          disabled={loading}
          className="text-amber-600 border-amber-300 hover:bg-amber-50 hover:text-amber-700"
          title="Unlock questions for editing. Submissions already extracted will be marked stale when you save changes."
        >
          <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
          {loading ? "Saving…" : "Return to Draft"}
        </Button>
      </div>
    );
  }

  return (
    <Button
      onClick={handleActivate}
      disabled={loading || questionsCount === 0}
      className="bg-blue-600 hover:bg-blue-700 text-white"
    >
      <Rocket className="w-4 h-4 mr-2" />
      {loading ? "Activating..." : "Publish Template"}
    </Button>
  );
}
