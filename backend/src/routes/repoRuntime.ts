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

repoRuntimeRoute.post('/launch', async (req: Request, res: Response) => {
  try {
    const { repoId } = req.body as { repoId?: string };

    if (!repoId) {
      return res.status(400).json({ success: false, error: 'Provide a repoId.' });
    }

    const result = await repoRuntimeService.launch(repoId);
    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not launch repository runtime.';
    return res.status(500).json({ success: false, error: message });
  }
});

repoRuntimeRoute.get('/status/:repoId', (req: Request<{ repoId: string }>, res: Response) => {
  try {
    const result = repoRuntimeService.getStatus(req.params.repoId);
    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not get runtime status.';
    return res.status(404).json({ success: false, error: message });
  }
});

repoRuntimeRoute.post('/stop', async (req: Request, res: Response) => {
  try {
    const { repoId } = req.body as { repoId?: string };

    if (!repoId) {
      return res.status(400).json({ success: false, error: 'Provide a repoId.' });
    }

    const result = await repoRuntimeService.stop(repoId);
    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not stop repository runtime.';
    return res.status(500).json({ success: false, error: message });
  }
});
