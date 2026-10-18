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

// ---- JSON Schemas sent to the model API for constrained ("structured") output ----
// Reasoning models sometimes emit broken JSON; constrained decoding prevents that.
// The zod schemas above still validate every reply.
export const EXTRACT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    claims: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        properties: {
          claim: { type: 'string', maxLength: 500 },
          type: { type: 'string', enum: CLAIM_TYPES },
          language: { type: 'string', maxLength: 10 },
        },
        required: ['claim', 'type', 'language'],
      },
    },
  },
  required: ['claims'],
};

export const JUDGE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: VERDICTS },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    explanation: { type: 'string', maxLength: 400 },
    source_url: { type: ['string', 'null'] },
  },
  required: ['verdict', 'confidence', 'explanation', 'source_url'],
};

// ---- Search results (untrusted, but we still bound their shape) ----
export const SourceSchema = z.object({
  title: z.string().max(300).catch(''),
  url: z.string().url().refine((u) => /^https?:\/\//i.test(u), 'http(s) only'),
  content: z.string().catch('').transform((s) => s.slice(0, 2000)),
});
