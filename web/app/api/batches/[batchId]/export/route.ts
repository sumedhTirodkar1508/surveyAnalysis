import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import ExcelJS from "exceljs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ batchId: string }> }
) {
  const { batchId } = await params;

  try {
    // 1. Fetch the batch with version and questions
    const batch = await prisma.surveyBatch.findUnique({
      where: { id: batchId },
      include: {
        surveyVersion: {
          include: {
            questions: {
              orderBy: { displayOrder: "asc" },
            },
          },
        },
      },
    });

    if (!batch) {
      return new NextResponse("Batch not found", { status: 404 });
    }

    // 2. Fetch all submissions for this batch
    const submissions = await prisma.surveySubmission.findMany({
      where: {
        batchId,
        status: { in: ["EXTRACTED", "NEEDS_REVIEW", "REVIEWED", "FINALIZED"] },
      },
      include: {
        responses: {
          include: {
            question: true,
          },
        },
      },
      orderBy: { participantIndex: "asc" },
    });

    // 3. Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Survey Results");

    // 4. Define Columns
    const questions = batch.surveyVersion.questions;
    const columns = [
      { header: "Participant Identity", key: "identity", width: 25 },
      { header: "Confidence Score", key: "confidence", width: 15 },
      ...questions.map((q) => ({
        header: `${q.questionNumber}: ${q.questionText}`,
        key: q.id,
        width: 30,
      })),
    ];
    worksheet.columns = columns;

    // Style the header
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE0E0E0" },
    };

    // 5. Add Data Rows
    submissions.forEach((submission) => {
      const rowData: any = {
        identity: submission.participantNameCorrected || submission.participantNameExtracted || "Anonymous",
        confidence: submission.confidenceScore ? `${(submission.confidenceScore * 100).toFixed(0)}%` : "N/A",
      };

      // Map responses to question IDs
      submission.responses.forEach((resp) => {
        const qId = resp.questionId;
        const value = resp.finalValueJson || resp.correctedValueJson || resp.rawExtractedValueJson;

        if (value && typeof value === "object") {
          const valObj = value as any;
          // Handle different formats based on what the worker/UI saves
          // The user requested specific flattening rules:
          
          // MULTI_SELECT (usually an array in 'value' key or just an array)
          const actualValue = valObj.value !== undefined ? valObj.value : valObj;

          if (Array.isArray(actualValue)) {
            rowData[qId] = actualValue.join(", ");
          } else if (typeof actualValue === "object" && actualValue !== null) {
            // MATRIX (Row: Col mapping)
            const matrixEntries = Object.entries(actualValue)
              .map(([row, col]) => {
                const colDisplay = Array.isArray(col) ? col.join(", ") : col;
                return `${row}: ${colDisplay}`;
              });
            rowData[qId] = matrixEntries.join(", ");
          } else {
            rowData[qId] = String(actualValue ?? "");
          }
        } else {
          rowData[qId] = value ?? "";
        }
      });

      worksheet.addRow(rowData);
    });

    // 6. Generate Buffer and Return
    const buffer = await workbook.xlsx.writeBuffer();
    
    const dateStr = new Date().toISOString().split("T")[0];
    const safeBatchName = batch.batchName.replace(/[^a-z0-9]/gi, "_");
    const filename = `${safeBatchName}_Results_${dateStr}.xlsx`;

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });

  } catch (error) {
    console.error("Export Error:", error);
    return new NextResponse("Export Failed", { status: 500 });
  }
}
