import { useEffect } from 'react';

interface PluginMessageHandlers {
  onSuccess: (message: { count: number; warnings?: string[]; screens?: Array<{ name: string; width: number; height: number; componentType: string }> }) => void;
  onError: (message: { message?: string }) => void;
}

export function usePluginMessage({ onSuccess, onError }: PluginMessageHandlers) {
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data?.pluginMessage;
      if (!message) {
        return;
      }

      if (message.type === 'SUCCESS') {
        onSuccess(message);
      }

      if (message.type === 'ERROR') {
        onError(message);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onError, onSuccess]);
}
