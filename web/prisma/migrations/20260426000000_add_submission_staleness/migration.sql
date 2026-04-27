-- Add staleness tracking to SurveySubmission.
-- isStale: true when the template version was returned to draft and a question
--          was edited after this submission was extracted.
-- staleQuestionIds: JSON array of questionIds that changed, used for smart
--                   partial re-extraction (only those questions are re-sent to AI).

ALTER TABLE "SurveySubmission"
  ADD COLUMN IF NOT EXISTS "isStale" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "SurveySubmission"
  ADD COLUMN IF NOT EXISTS "staleQuestionIds" JSONB;
