import { Request, Response, Router } from 'express';
import { geminiService } from '../services/geminiService';
import { githubService } from '../services/githubService';
import { parserService } from '../services/parserService';
import { validationService } from '../services/validationService';

export const parseRoute = Router();

parseRoute.post('/', async (req: Request, res: Response) => {
  try {
    const { code, githubUrl, mode, apiKey } = req.body as {
      code?: string;
      githubUrl?: string;
      mode?: string;
      apiKey?: string;
    };

    if (!code && !githubUrl) {
      return res.status(400).json({ success: false, error: 'Provide either code or githubUrl.' });
    }

    let rawCode = code ?? '';

    if (githubUrl) {
      try {
        rawCode = await githubService.fetchFromUrl(githubUrl);
      } catch {
        return res.status(400).json({ success: false, error: 'Could not fetch from GitHub URL' });
      }
    }

    const processed = parserService.preProcess(rawCode);
    const result = await geminiService.parse(processed, { mode, apiKey });
    const validated = validationService.validate(result);

    return res.json(validated);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('Parse error:', error);

    if (message === 'AI service unavailable') {
      return res.status(502).json({ success: false, screens: [], error: message });
    }

    return res.status(500).json({ success: false, screens: [], error: message });
  }
});
