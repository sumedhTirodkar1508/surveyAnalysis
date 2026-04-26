import { NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import ExcelJS from "exceljs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  try {
    const user = await requireUser();
    const { batchId } = await params;

    // Fetch batch with all finalized submissions and their responses
    const batch = await prisma.surveyBatch.findUnique({
      where: { id: batchId },
      include: {
        survey: true,
        surveyVersion: {
          include: {
            questions: {
              orderBy: { displayOrder: "asc" },
            },
          },
        },
        submissions: {
          orderBy: { participantIndex: "asc" },
          include: {
            responses: {
              include: { question: true },
            },
          },
        },
      },
    });

    if (!batch) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }

    const questions = batch.surveyVersion.questions;

    // Build Excel workbook
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Survey Digitization App";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("Survey Data", {
      pageSetup: { fitToPage: true, orientation: "landscape" },
    });

    // Header row
    const headerRow = [
      "Participant #",
      "Name",
      "Status",
      ...questions.map((q) => `Q${q.questionNumber}: ${q.questionText.substring(0, 50)}`),
    ];
    sheet.addRow(headerRow);

    // Style header
    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1E3A5F" },
    };
    header.height = 24;
    header.alignment = { vertical: "middle", wrapText: true };

    // Freeze header
    sheet.views = [{ state: "frozen", xSplit: 0, ySplit: 1 }];

    // Data rows
    for (const submission of batch.submissions) {
      const responseMap = new Map(
        submission.responses.map((r) => [r.questionId, r])
      );

      const rowData: any[] = [
        submission.participantIndex,
        submission.participantNameCorrected ??
          submission.participantNameExtracted ??
          "",
        submission.status,
      ];

      for (const question of questions) {
        const response = responseMap.get(question.id);
        if (!response) {
          rowData.push("");
          continue;
        }

        const val =
          response.finalValueJson ??
          response.correctedValueJson ??
          response.rawExtractedValueJson;

        if (!val) {
          rowData.push("");
          continue;
        }

        const parsed = val as any;
        if (parsed.type === "checkbox") {
          const selected: any[] = parsed.selected ?? [];
          rowData.push(selected.map((s) => s?.label || s).join(", "));
        } else if (parsed.type === "text") {
          rowData.push(parsed.value ?? "");
        } else {
          rowData.push(JSON.stringify(val));
        }
      }

      const row = sheet.addRow(rowData);
      // Color-code by status
      if (submission.status === "FINALIZED") {
        row.getCell(3).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFD1FAE5" },
        };
      } else if (submission.status === "NEEDS_REVIEW") {
        row.getCell(3).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFFEF3C7" },
        };
      }
    }

    // Auto-fit columns
    sheet.columns.forEach((col, i) => {
      if (i < 3) {
        col.width = 18;
      } else {
        col.width = 30;
      }
    });

    // Add metadata sheet
    const metaSheet = workbook.addWorksheet("Export Info");
    metaSheet.addRow(["Survey", batch.survey.title]);
    metaSheet.addRow(["Batch", batch.batchName]);
    metaSheet.addRow(["Export Date", new Date().toISOString()]);
    metaSheet.addRow(["Total Submissions", batch.submissions.length]);
    metaSheet.addRow(["Exported By", user.email ?? user.id]);

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();

    const filename = `${batch.survey.title}-${batch.batchName}-export.xlsx`
      .replace(/[^a-z0-9.\-_]/gi, "_")
      .toLowerCase();

    return new NextResponse(buffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err: any) {
    if (err?.code === "UNAUTHENTICATED")
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.error("Export error:", err);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
