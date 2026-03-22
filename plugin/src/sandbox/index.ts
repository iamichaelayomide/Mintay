import type { MintayParseResult } from '../../../shared/types/mintaySchema';
import { buildScreen } from './builder/nodeBuilder';

const uiHtml = __MINTAY_UI_HTML__;

declare const __MINTAY_UI_HTML__: string;

const DEFAULT_BACKEND_URL = 'http://localhost:3001';

figma.showUI(uiHtml, {
  width: 420,
  height: 580,
  title: 'Mintay - Code to Figma',
  themeColors: true,
});

figma.ui.onmessage = async (msg: { type?: string; data?: unknown; requestId?: string }) => {
  switch (msg.type) {
    case 'BUILD_SCREENS':
      await handleBuildScreens(msg.data as MintayParseResult);
      break;
    case 'GET_SETTINGS':
      await handleGetSettings(msg.requestId);
      break;
    case 'SAVE_SETTINGS':
      await handleSaveSettings(
        msg.data as { apiKey?: string; backendUrl?: string },
        msg.requestId,
      );
      break;
    case 'CLOSE':
      figma.closePlugin();
      break;
    default:
      break;
  }
};

async function handleGetSettings(requestId?: string) {
  const apiKey = await figma.clientStorage.getAsync('mintay_api_key');
  const backendUrl = (await figma.clientStorage.getAsync('mintay_backend_url')) || DEFAULT_BACKEND_URL;

  figma.ui.postMessage({
    type: 'SETTINGS_VALUE',
    requestId,
    data: {
      apiKey: typeof apiKey === 'string' ? apiKey : '',
      backendUrl: typeof backendUrl === 'string' ? backendUrl : DEFAULT_BACKEND_URL,
    },
  });
}

async function handleSaveSettings(
  settings: { apiKey?: string; backendUrl?: string },
  requestId?: string,
) {
  await figma.clientStorage.setAsync('mintay_api_key', settings.apiKey || '');
  await figma.clientStorage.setAsync('mintay_backend_url', settings.backendUrl || DEFAULT_BACKEND_URL);

  figma.ui.postMessage({
    type: 'SETTINGS_SAVED',
    requestId,
    data: {
      apiKey: settings.apiKey || '',
      backendUrl: settings.backendUrl || DEFAULT_BACKEND_URL,
    },
  });
}

async function handleBuildScreens(parseResult: MintayParseResult) {
  const { screens, warnings = [], error } = parseResult;

  if (!parseResult.success) {
    figma.ui.postMessage({
      type: 'ERROR',
      message: error || 'Mintay could not parse the provided input.',
    });
    return;
  }

  if (!screens || screens.length === 0) {
    figma.ui.postMessage({ type: 'ERROR', message: 'No screens found in result.' });
    return;
  }

  const builtFrames: FrameNode[] = [];
  const buildWarnings = warnings.slice();
  let xOffset = 0;
  const gap = 120;

  for (const screen of screens) {
    try {
      const { frame, warnings: screenWarnings } = await buildScreen(screen);
      frame.x = xOffset;
      frame.y = 0;
      figma.currentPage.appendChild(frame);
      builtFrames.push(frame);
      xOffset += screen.width + gap;
      Array.prototype.push.apply(buildWarnings, screenWarnings);
    } catch (buildError) {
      const message = buildError instanceof Error ? buildError.message : 'Unknown build error';
      buildWarnings.push(`Failed to build screen "${screen.name}": ${message}`);
    }
  }

  if (builtFrames.length === 0) {
    figma.ui.postMessage({
      type: 'ERROR',
      message: 'Mintay could not build any screens from the generated layout.',
    });
    return;
  }

  figma.currentPage.selection = builtFrames;
  figma.viewport.scrollAndZoomIntoView(builtFrames);
  figma.ui.postMessage({
    type: 'SUCCESS',
    count: builtFrames.length,
    warnings: buildWarnings,
    screens: screens.map((screen) => ({
      name: screen.name,
      width: screen.width,
      height: screen.height,
      componentType: screen.componentType || 'DESKTOP',
    })),
  });
}
