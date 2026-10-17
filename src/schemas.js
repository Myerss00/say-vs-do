// zod schemas for everything that crosses a trust boundary: HTTP input and LLM output.
import { z } from 'zod';

export const MAX_TEXT_LENGTH = 5000;
export const VERDICTS = ['SUPPORTED', 'MISLEADING', 'FALSE', 'UNVERIFIABLE'];
export const CLAIM_TYPES = ['news', 'corporate', 'green'];

// ---- HTTP input ----
export const CheckRequestSchema = z
  .object({
    text: z.string().trim().min(3, 'text too short').max(MAX_TEXT_LENGTH, `text longer than ${MAX_TEXT_LENGTH} chars`),
    mode: z.enum(['news', 'corporate']).default('news'),
    lang: z.enum(['de-DE', 'en-US', 'es-ES']).optional(),
  })
  .strict();

export const SessionIdSchema = z.string().regex(/^[A-Za-z0-9-]{8,64}$/);

// ---- LLM output ----
export const ClaimSchema = z.object({
  claim: z.string().trim().min(3).max(500),
  type: z.enum(CLAIM_TYPES),
  language: z.string().trim().min(2).max(10),
});
export const ClaimListSchema = z.array(ClaimSchema).max(20);

export const VerdictSchema = z.object({
  verdict: z.enum(VERDICTS),
  confidence: z.number().min(0).max(1),
  explanation: z.string().trim().min(1).max(400),
  source_url: z.string().url().nullable().optional(),
});

// ---- Search results (untrusted, but we still bound their shape) ----
export const SourceSchema = z.object({
  title: z.string().max(300).catch(''),
  url: z.string().url().refine((u) => /^https?:\/\//i.test(u), 'http(s) only'),
  content: z.string().catch('').transform((s) => s.slice(0, 2000)),
});
