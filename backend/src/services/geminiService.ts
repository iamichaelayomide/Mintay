import { GoogleGenerativeAI } from '@google/generative-ai';
import { MintayParseResult } from '../../../shared/types/mintaySchema';
import { SYSTEM_PROMPT, buildUserPrompt } from '../prompts/layoutPrompt';

const modelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

function createClient(overrideApiKey?: string): GoogleGenerativeAI {
  const resolvedApiKey = overrideApiKey || process.env.GEMINI_API_KEY;

  if (!resolvedApiKey) {
    throw new Error('AI service unavailable');
  }

  return new GoogleGenerativeAI(resolvedApiKey);
}

async function requestLayout(code: string, mode?: string, apiKey?: string): Promise<string> {
  const client = createClient(apiKey);

  const model = client.getGenerativeModel({
    model: modelName,
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: {
      temperature: 0.1,
      topP: 0.8,
      maxOutputTokens: 32000,
      responseMimeType: 'application/json',
    },
  });

  const result = await model.generateContent(buildUserPrompt(code, mode));
  return result.response.text().trim();
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

          throw new Error('AI service unavailable');
        }
      }
    }

    throw new Error('AI service unavailable');
  },
};
