import { Request, Response, Router } from 'express';
import { repoRuntimeService } from '../services/repoRuntimeService';

export const repoRuntimeRoute = Router();

repoRuntimeRoute.post('/prepare', async (req: Request, res: Response) => {
  try {
    const { githubUrl } = req.body as { githubUrl?: string };

    if (!githubUrl) {
      return res.status(400).json({ success: false, error: 'Provide a GitHub repository URL.' });
    }

    const result = await repoRuntimeService.prepareFromGithubUrl(githubUrl);
    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not prepare repository runtime workspace.';
    return res.status(500).json({ success: false, error: message });
  }
});
