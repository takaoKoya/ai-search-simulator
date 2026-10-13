import { z } from "zod";

export const templateInputSchema = z.object({
  name: z.string().trim().min(1, "テンプレート名を入力してください").max(50, "テンプレート名は50文字以内です"),
  body: z.string().trim().min(1, "本文を入力してください").max(5000, "本文は5000文字以内です"),
  /** null = shared by every job */
  jobId: z.string().min(1).nullable().optional(),
});
export type TemplateInput = z.infer<typeof templateInputSchema>;

export const templateUpdateSchema = templateInputSchema.pick({ name: true, body: true });
