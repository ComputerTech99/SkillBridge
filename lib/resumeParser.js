/**
 * Resume text normalization and PDF text extraction utilities using pdf-parse.
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

const MIN_EXTRACTED_CHARS = 30;

export function cleanResumeText(rawText) {
  if (!rawText || typeof rawText !== "string") return "";

  const normalized = rawText
    .replace(/[\u200b\u200c\u200d\ufeff]/g, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return normalized;
}

export async function extractTextFromPdfBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error("Empty or unreadable PDF");
  }

  let parsed;
  try {
    parsed = await pdfParse(buffer);
  } catch {
    throw new Error("Empty or unreadable PDF");
  }

  const cleaned = cleanResumeText(parsed?.text || "");
  if (cleaned.length < MIN_EXTRACTED_CHARS) {
    throw new Error("Empty or unreadable PDF");
  }
  return cleaned;
}
