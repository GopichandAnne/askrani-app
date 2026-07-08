// File → text extraction for KB uploads — Bot Phase 3g.
//   text / csv / md / json  → decode directly.
//   xlsx / xls              → SheetJS reads every sheet to CSV.
//   pdf / images            → Gemini multimodal transcribes (and describes photos).
// Returns "" on failure (caller treats as "nothing extracted").

import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

function isTextLike(mime: string, filename: string): boolean {
  return (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/csv" ||
    /\.(txt|md|markdown|csv|tsv|json|log)$/i.test(filename)
  );
}

function isSpreadsheet(mime: string, filename: string): boolean {
  return (
    mime.includes("spreadsheetml") || // .xlsx
    mime === "application/vnd.ms-excel" || // .xls
    /\.(xlsx|xlsm|xls)$/i.test(filename)
  );
}

/** Read every sheet of an Excel workbook into CSV text (one block per sheet). */
function extractSpreadsheet(bytes: Uint8Array): string {
  try {
    const wb = XLSX.read(bytes, { type: "array" });
    const parts: string[] = [];
    for (const name of wb.SheetNames) {
      const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]).trim();
      if (csv) parts.push(wb.SheetNames.length > 1 ? `Sheet: ${name}\n${csv}` : csv);
    }
    return parts.join("\n\n").trim();
  } catch (e) {
    console.error("[extract] xlsx error:", e);
    return "";
  }
}

export async function extractFileText(
  bytes: Uint8Array,
  mime: string,
  filename = "",
): Promise<string> {
  if (isSpreadsheet(mime, filename)) {
    return extractSpreadsheet(bytes);
  }
  if (isTextLike(mime, filename)) {
    return new TextDecoder().decode(bytes).trim();
  }
  if (mime === "application/pdf" || mime.startsWith("image/")) {
    return await geminiExtract(bytes, mime);
  }
  // Unknown type — best-effort decode (may be gibberish; caller can reject empty).
  return new TextDecoder().decode(bytes).trim();
}

async function geminiExtract(bytes: Uint8Array, mime: string): Promise<string> {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) return "";
  const model = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.5-flash";
  const prompt = mime.startsWith("image/")
    ? "Transcribe ALL text visible in this image exactly (menu items, prices, labels, signs, hours). If it is a photo of products or a place, ALSO add a short factual description of what it shows. Plain text only, no commentary."
    : "Transcribe ALL text from this document exactly, preserving structure — keep sections, lists, and table rows on their own lines. Plain text only, no commentary.";

  try {
    const res = await fetch(`${API_BASE}/models/${model}:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [
            { inlineData: { mimeType: mime, data: encodeBase64(bytes) } },
            { text: prompt },
          ],
        }],
        generationConfig: { temperature: 0, maxOutputTokens: 8192, thinkingConfig: { thinkingBudget: 0 } },
      }),
    });
    if (!res.ok) {
      console.error(`[extract] gemini ${res.status}: ${await res.text()}`);
      return "";
    }
    // deno-lint-ignore no-explicit-any
    const json: any = await res.json();
    return (json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "").trim();
  } catch (e) {
    console.error("[extract] error:", e);
    return "";
  }
}
