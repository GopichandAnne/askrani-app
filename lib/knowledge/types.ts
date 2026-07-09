import type { Database } from "@/lib/database.types";

export type SavedQA = Database["public"]["Tables"]["saved_qa"]["Row"];

export type SavedQAInput = {
  question: string;
  answer?: string | null;
  category?: string | null;
  active?: boolean;
};

export type SavedQAPatch = Partial<
  Pick<SavedQA, "question" | "answer" | "category" | "active">
>;

/** A knowledge-base document, aggregated from its knowledge_index chunks. */
export type KnowledgeDoc = {
  title: string;
  chunks: number;
  /** true when every chunk has been embedded (none stale). */
  indexed: boolean;
  updatedAt: string | null;
  /** Storage path of the original uploaded file, if it came from an upload. */
  sourcePath: string | null;
  sourceMime: string | null;
  /** Optional effective window (YYYY-MM-DD). Outside it, the bot won't surface
   *  this doc. Null = open-ended. */
  validFrom: string | null;
  validUntil: string | null;
};
