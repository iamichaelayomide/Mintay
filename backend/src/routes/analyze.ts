import { Request, Response, Router } from 'express';
import { analysisService } from '../services/analysisService';
import { githubService } from '../services/githubService';

export const analyzeRoute = Router();

analyzeRoute.post('/', async (req: Request, res: Response) => {
  try {
    const { code, githubUrl } = req.body as {
      code?: string;
      githubUrl?: string;
    };

    if (!code && !githubUrl) {
      return res.status(400).json({ success: false, error: 'Provide either code or githubUrl.' });
    }

    let rawCode = code ?? '';

    if (githubUrl) {
      try {
        rawCode = await githubService.fetchFromUrl(githubUrl);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not fetch from GitHub URL';
        return res.status(400).json({ success: false, error: message });
      }
    }

    return res.json({
      success: true,
      sections: analysisService.detectSections(rawCode),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('Analyze error:', error);
    return res.status(500).json({ success: false, sections: [], error: message });
  }
});
