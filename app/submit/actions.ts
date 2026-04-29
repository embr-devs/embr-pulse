"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { insertFeedback } from "@/lib/feedback";

const FeedbackSchema = z.object({
  submitterName: z.string().trim().min(1, "Name is required").max(100),
  submitterEmail: z.string().trim().email("Must be a valid email").max(200),
  title: z.string().trim().min(3, "Title is too short").max(140),
  body: z.string().trim().min(10, "Add a few more details").max(4000),
  category: z.enum(["bug", "feature", "question", "other"]).nullable(),
});

export type SubmitFeedbackResult =
  | { ok: true }
  | { ok: false; fieldErrors: Record<string, string[] | undefined> };

export async function submitFeedbackAction(
  _prev: SubmitFeedbackResult | null,
  formData: FormData,
): Promise<SubmitFeedbackResult> {
  const parsed = FeedbackSchema.safeParse({
    submitterName: formData.get("submitterName"),
    submitterEmail: formData.get("submitterEmail"),
    title: formData.get("title"),
    body: formData.get("body"),
    category: (formData.get("category") || null) as
      | "bug"
      | "feature"
      | "question"
      | "other"
      | null,
  });

  if (!parsed.success) {
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };
  }

  await insertFeedback(parsed.data);
  revalidatePath("/");
  redirect("/?submitted=1");
}
