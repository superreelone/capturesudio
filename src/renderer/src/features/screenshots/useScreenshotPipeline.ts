import { useCallback, useState } from 'react';
import type {
  CaptureScreenshotRequest,
  CaptureScreenshotResponse,
  SaveScreenshotResponse,
  ScreenshotFormat
} from '@shared/screenshot.types';
import { encodeCanvas, pngBase64FromCanvas } from './encoders';

export interface ScreenshotCaptureState {
  status: 'idle' | 'capturing' | 'ready' | 'saving' | 'done' | 'error';
  captured: CaptureScreenshotResponse | null;
  saved: SaveScreenshotResponse | null;
  error: string | null;
}

const INITIAL: ScreenshotCaptureState = {
  status: 'idle',
  captured: null,
  saved: null,
  error: null
};

export function useScreenshotPipeline() {
  const [state, setState] = useState<ScreenshotCaptureState>(INITIAL);

  const capture = useCallback(
    async (req: CaptureScreenshotRequest): Promise<CaptureScreenshotResponse | null> => {
      setState({ ...INITIAL, status: 'capturing' });
      try {
        const res = await window.api.screenshot.capture(req);
        setState({ status: 'ready', captured: res, saved: null, error: null });
        return res;
      } catch (err) {
        setState({
          status: 'error',
          captured: null,
          saved: null,
          error: err instanceof Error ? err.message : String(err)
        });
        return null;
      }
    },
    []
  );

  const saveFromCanvas = useCallback(
    async (
      canvas: HTMLCanvasElement,
      format: ScreenshotFormat,
      quality: number,
      sourceLabel: string,
      alsoClipboard: boolean
    ): Promise<SaveScreenshotResponse | null> => {
      setState((s) => ({ ...s, status: 'saving', error: null }));
      try {
        const { base64 } = await encodeCanvas(canvas, format, quality);
        const saved = await window.api.screenshot.save({
          encodedBase64: base64,
          format,
          sourceLabel
        });
        if (alsoClipboard) {
          const pngBase64 =
            format === 'png' ? base64 : await pngBase64FromCanvas(canvas);
          await window.api.screenshot.clipboard({ pngBase64 });
        }
        setState((s) => ({ ...s, status: 'done', saved }));
        return saved;
      } catch (err) {
        setState((s) => ({
          ...s,
          status: 'error',
          error: err instanceof Error ? err.message : String(err)
        }));
        return null;
      }
    },
    []
  );

  const copyOriginalToClipboard = useCallback(async (): Promise<void> => {
    const pngBase64 = state.captured?.pngBase64;
    if (!pngBase64) return;
    await window.api.screenshot.clipboard({ pngBase64 });
  }, [state.captured]);

  const reset = useCallback((): void => setState(INITIAL), []);

  return {
    state,
    capture,
    saveFromCanvas,
    copyOriginalToClipboard,
    reset
  };
}
