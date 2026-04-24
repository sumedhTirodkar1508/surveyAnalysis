"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { QuestionType, SurveyQuestion } from "@prisma/client";
import { upsertQuestion } from "@/_actions/questions";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";

export function QuestionEditor({ versionId, question, questionsCount = 0 }: { versionId: string, question?: SurveyQuestion, questionsCount?: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  
  const [questionNumber, setQuestionNumber] = useState(question?.questionNumber || "");
  const [questionText, setQuestionText] = useState(question?.questionText || "");
  const [questionType, setQuestionType] = useState<QuestionType>(question?.questionType || "FREE_TEXT");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await upsertQuestion({
        id: question?.id,
        surveyVersionId: versionId,
        questionNumber,
        questionText,
        questionType,
        displayOrder: question?.displayOrder ?? questionsCount, // new questions go at end
      });
      toast.success("Question saved.");
      setOpen(false);
      router.refresh();
      if (!question) {
        setQuestionNumber("");
        setQuestionText("");
        setQuestionType("FREE_TEXT");
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to save question.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant={question ? "outline" : "default"}>
            {question ? "Edit" : <><Plus className="w-4 h-4 mr-2" /> Add Question</>}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{question ? "Edit Question" : "Add Question"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="qnum">Question Number</Label>
            <Input id="qnum" value={questionNumber} onChange={e => setQuestionNumber(e.target.value)} placeholder="e.g. 1a" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="qtext">Question Text</Label>
            <Input id="qtext" value={questionText} onChange={e => setQuestionText(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="qtype">Type</Label>
            <select 
              id="qtype"
              className="w-full flex h-10 w-full items-center justify-between rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm"
              value={questionType} 
              onChange={e => setQuestionType(e.target.value as QuestionType)}
            >
              {Object.keys(QuestionType).map(t => (
                <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>
          
          <div className="flex justify-end pt-4">
            <Button type="submit" disabled={loading}>
              {loading ? "Saving..." : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
