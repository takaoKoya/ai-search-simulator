import { z } from "zod";

export const TARGET_TYPES = ["ALBAIT", "SPECIALIST", "GENERAL"] as const;

export const generateJobInputSchema = z.object({
  text: z.string().trim().min(10, "職種・勤務地・給与などを10文字以上で入力してください").max(4000),
});
export type GenerateJobInput = z.infer<typeof generateJobInputSchema>;

export const lineQuestionSchema = z.object({
  question: z.string().min(1),
  options: z.array(z.string().min(1)).min(2).max(4),
});

export const generatedJobSchema = z.object({
  targetType: z.enum(TARGET_TYPES),
  snsPostText: z.object({
    x: z.string().min(1),
    instagram: z.string().min(1),
    line: z.string().min(1),
  }),
  indeedText: z.string().min(1),
  lineQuestions: z.array(lineQuestionSchema).length(3),
});
export type GeneratedJob = z.infer<typeof generatedJobSchema>;
