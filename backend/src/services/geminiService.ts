import axios from 'axios';
import { MintayParseResult } from '../../../shared/types/mintaySchema';
import { SYSTEM_PROMPT, buildUserPrompt } from '../prompts/layoutPrompt';

const modelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
const GEMINI_TIMEOUT_MS = 600000;

function resolveApiKey(overrideApiKey?: string): string {
  const resolvedApiKey = overrideApiKey || process.env.GEMINI_API_KEY;

  if (!resolvedApiKey) {
    throw new Error('AI service unavailable');
  }

  return resolvedApiKey;
}

async function requestLayout(code: string, mode?: string, apiKey?: string): Promise<string> {
  const resolvedApiKey = resolveApiKey(apiKey);
  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${resolvedApiKey}`,
    {
      system_instruction: {
        parts: [{ text: SYSTEM_PROMPT }],
      },
      contents: [
        {
          parts: [{ text: buildUserPrompt(code, mode) }],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        topP: 0.8,
        maxOutputTokens: 32000,
        responseMimeType: 'application/json',
      },
    },
    {
      timeout: GEMINI_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
      },
    },
  );

  const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('Gemini returned no text content.');
  }

  return text.trim();
}

function parseResponse(text: string): MintayParseResult {
  const cleaned = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const parsed = JSON.parse(cleaned) as MintayParseResult;

  if (!Array.isArray(parsed.screens)) {
    throw new Error('Gemini response missing screens array.');
  }

  return parsed;
}

export const geminiService = {
  async parse(
    code: string,
    options?: { mode?: string; apiKey?: string },
  ): Promise<MintayParseResult> {
    let lastRaw = '';

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        lastRaw = await requestLayout(code, options?.mode, options?.apiKey);
        return parseResponse(lastRaw);
      } catch (error) {
        if (error instanceof SyntaxError && attempt === 0) {
          continue;
        }

        if (error instanceof Error && error.message === 'AI service unavailable') {
          throw error;
        }

        if (attempt === 1) {
          if (error instanceof SyntaxError) {
            throw new Error(`Gemini returned invalid JSON. Raw: ${lastRaw.slice(0, 300)}`);
          }

          if (axios.isAxiosError(error)) {
            const apiMessage =
              error.response?.data?.error?.message ||
              error.response?.data?.message ||
              error.message;
            throw new Error(`Gemini API error: ${apiMessage}`);
          }

          if (error instanceof Error) {
            throw new Error(`Gemini request failed: ${error.message}`);
          }

          throw new Error('AI service unavailable');
        }
      }
    }

    throw new Error('AI service unavailable');
  },
};
