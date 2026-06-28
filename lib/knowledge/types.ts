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
