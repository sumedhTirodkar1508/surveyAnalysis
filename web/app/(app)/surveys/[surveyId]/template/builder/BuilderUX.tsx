"use client";

import { useState } from "react";
import { PageCanvas, BoundingBox } from "@/components/template-builder/PageCanvas";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { upsertMapping, deleteMapping } from "@/_actions/mappings";
import { activateVersion } from "@/_actions/versions";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

export function BuilderUX({ surveyId, versionId, questions, pageUrls }: any) {
  const router = useRouter();
  const [currentPage, setCurrentPage] = useState(0);
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
  const [selectedMappingId, setSelectedMappingId] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);

  const selectedQuestion = questions.find((q: any) => q.id === selectedQuestionId);

  // Filter mappings for the current page
  const allMappings = questions.flatMap((q: any) => 
    q.fieldMappings.map((m: any) => ({
      ...m,
      question: q
    }))
  );
  
  const pageMappings = allMappings.filter((m: any) => m.pageNumber === currentPage);
  
  const boxes: BoundingBox[] = pageMappings.map((m: any) => ({
    id: m.id,
    x: m.x,
    y: m.y,
    w: m.width,
    h: m.height,
    color: m.questionId === selectedQuestionId ? "#3b82f6" : "#10b981"
  }));

  const handleBoxCreate = async (box: BoundingBox) => {
    if (!selectedQuestionId) {
      toast.error("Please select a question from the list first.");
      return;
    }

    let optionLabel = undefined;
    let fieldType = "TEXT_BOX" as import("@prisma/client").FieldType;
    
    if (["CHECKBOX_MULTIPLE", "RADIO_SINGLE"].includes(selectedQuestion.questionType)) {
      optionLabel = prompt("Enter the option value for this box (e.g. 'Yes', 'No', 'Option A'):");
      if (!optionLabel) return;
      fieldType = "CHECKBOX" as import("@prisma/client").FieldType;
    } else if (selectedQuestion.questionType === "MATRIX") {
      optionLabel = prompt("Enter the matrix cell identifier (e.g. 'Row1-Col1'):");
      if (!optionLabel) return;
      fieldType = "MATRIX_CHECKBOX" as import("@prisma/client").FieldType;
    }

    try {
      await upsertMapping({
        questionId: selectedQuestionId,
        fieldType,
        pageNumber: currentPage,
        x: box.x,
        y: box.y,
        width: box.w,
        height: box.h,
        optionLabel
      });
      toast.success("Box created");
      router.refresh();
    } catch (err: any) {
      toast.error(err.message || "Failed to create box");
    }
  };

  const handleBoxUpdate = async (id: string, box: Partial<BoundingBox>) => {
    const mapping = allMappings.find((m: any) => m.id === id);
    if (!mapping) return;

    try {
      await upsertMapping({
        id,
        questionId: mapping.questionId,
        fieldType: mapping.fieldType,
        pageNumber: mapping.pageNumber,
        x: box.x !== undefined ? box.x : mapping.x,
        y: box.y !== undefined ? box.y : mapping.y,
        width: box.w !== undefined ? box.w : mapping.width,
        height: box.h !== undefined ? box.h : mapping.height,
        optionLabel: mapping.optionLabel
      });
      router.refresh();
    } catch (err: any) {
      toast.error("Failed to update box");
    }
  };

  const handleBoxDelete = async (id: string) => {
    try {
      await deleteMapping(id);
      router.refresh();
    } catch (err: any) {
      toast.error("Failed to delete box");
    }
  };

  const handleMappingDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm("Delete this mapping?")) return;
    await handleBoxDelete(id);
  };

  const handleActivate = async () => {
    setActivating(true);
    try {
      await activateVersion(versionId);
      toast.success("Version activated successfully!");
      router.push(`/surveys/${surveyId}`);
    } catch (err: any) {
      toast.error(err.message || "Failed to activate version");
    } finally {
      setActivating(false);
    }
  };

  return (
    <div className="flex h-full bg-neutral-50">
      {/* LEFT PANE: Canvas */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        <div className="h-14 border-b bg-white flex items-center justify-between px-4 shrink-0">
          <div className="flex items-center gap-4">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
              disabled={currentPage === 0}
            >
              <ChevronLeft className="w-4 h-4 mr-1" /> Prev Page
            </Button>
            <span className="text-sm font-medium">Page {currentPage + 1} of {pageUrls.length}</span>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => setCurrentPage(p => Math.min(pageUrls.length - 1, p + 1))}
              disabled={currentPage === pageUrls.length - 1}
            >
              Next Page <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
          <div className="text-sm text-neutral-500">
            {selectedQuestionId ? (
              <span className="text-blue-600 font-medium">Draw box for Question {selectedQuestion.questionNumber}</span>
            ) : (
              "Select a question to draw boxes"
            )}
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4 flex justify-center bg-neutral-200">
          <div className="shadow-lg bg-white inline-block max-w-[800px] w-full">
            <PageCanvas
              imageUrl={pageUrls[currentPage]}
              boxes={boxes}
              onBoxCreate={handleBoxCreate}
              onBoxUpdate={handleBoxUpdate}
              onBoxDelete={handleBoxDelete}
              selectedBoxId={selectedMappingId}
              onBoxSelect={setSelectedMappingId}
            />
          </div>
        </div>
      </div>

      {/* RIGHT PANE: Questions list */}
      <div className="w-80 border-l bg-white flex flex-col shrink-0">
        <div className="h-14 border-b flex items-center justify-between px-4 shrink-0">
          <h3 className="font-semibold">Questions</h3>
          <Button size="sm" onClick={handleActivate} disabled={activating}>
            {activating ? "..." : "Activate"}
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {questions.map((q: any) => (
            <div 
              key={q.id} 
              className={`border rounded-md p-3 cursor-pointer transition-colors ${
                selectedQuestionId === q.id ? "border-blue-500 bg-blue-50 ring-1 ring-blue-500" : "hover:bg-neutral-50"
              }`}
              onClick={() => setSelectedQuestionId(q.id)}
            >
              <div className="font-medium text-sm">
                <span className="text-neutral-500 mr-2">{q.questionNumber}.</span>
                {q.questionText}
              </div>
              <div className="text-xs text-neutral-500 mt-1">{q.questionType.replace(/_/g, ' ')}</div>
              
              {/* List Mappings for this question */}
              {q.fieldMappings.length > 0 && (
                <div className="mt-3 space-y-1">
                  {q.fieldMappings.map((m: any) => (
                    <div 
                      key={m.id} 
                      className={`flex items-center justify-between text-xs p-1.5 rounded bg-white border ${selectedMappingId === m.id ? 'border-blue-400 bg-blue-50' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (m.pageNumber !== currentPage) setCurrentPage(m.pageNumber);
                        setSelectedMappingId(m.id);
                        setSelectedQuestionId(q.id);
                      }}
                    >
                      <span>
                        Pg {m.pageNumber + 1} {m.optionLabel && <span className="font-mono text-[10px] ml-1 bg-neutral-100 px-1 rounded">{m.optionLabel}</span>}
                      </span>
                      <button 
                        className="text-neutral-400 hover:text-red-500"
                        onClick={(e) => handleMappingDelete(e, m.id)}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
