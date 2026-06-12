import { desktopCapturer, ipcMain, screen } from 'electron';
import { IpcChannel } from '@shared/ipc-channels';
import type {
  CaptureSource,
  CaptureSourceKind,
  DisplayInfo,
  RegionRect
} from '@shared/recording.types';
import type {
  ListSourcesRequest,
  OpenRegionOverlayRequest,
  RunCountdownRequest
} from '@shared/ipc-types';
import { openRegionOverlay } from '@main/windows/region-overlay.window';
import { runCountdown } from '@main/windows/countdown.window';
import { createLogger } from '@main/util/logger';

const log = createLogger('capture');

function mapDisplay(d: Electron.Display, isPrimary: boolean): DisplayInfo {
  return {
    id: d.id,
    label: d.label || `Display ${d.id}`,
    bounds: d.bounds,
    workArea: d.workArea,
    scaleFactor: d.scaleFactor,
    isPrimary,
    rotation: d.rotation
  };
}

function pointInBounds(
  x: number,
  y: number,
  bounds: { x: number; y: number; width: number; height: number }
): boolean {
  return x >= bounds.x && x < bounds.x + bounds.width && y >= bounds.y && y < bounds.y + bounds.height;
}

function findDisplayForSource(
  source: Electron.DesktopCapturerSource,
  displays: Electron.Display[]
): number | undefined {
  if (source.display_id) {
    const numericId = Number(source.display_id);
    if (Number.isFinite(numericId)) return numericId;
  }
  if (displays.length === 1) return displays[0]?.id;
  return undefined;
}

export function registerCaptureHandlers(): void {
  ipcMain.handle(IpcChannel.CaptureListDisplays, (): DisplayInfo[] => {
    const primary = screen.getPrimaryDisplay();
    return screen.getAllDisplays().map((d) => mapDisplay(d, d.id === primary.id));
  });

  ipcMain.handle(
    IpcChannel.CaptureListSources,
    async (_event, payload: ListSourcesRequest): Promise<CaptureSource[]> => {
      const kinds = (payload?.kinds ?? ['screen', 'window']) as CaptureSourceKind[];
      const thumbnailSize = payload?.thumbnailSize ?? { width: 320, height: 180 };
      const sources = await desktopCapturer.getSources({
        types: kinds,
        thumbnailSize,
        fetchWindowIcons: true
      });
      const displays = screen.getAllDisplays();
      return sources.map((s) => {
        const kind: CaptureSourceKind = s.id.startsWith('screen:') ? 'screen' : 'window';
        const displayId = kind === 'screen' ? findDisplayForSource(s, displays) : undefined;
        return {
          id: s.id,
          name: s.name,
          kind,
          displayId,
          appIcon: s.appIcon ? s.appIcon.toDataURL() : undefined,
          thumbnail: s.thumbnail.toDataURL()
        };
      });
    }
  );

  ipcMain.handle(
    IpcChannel.CaptureOpenRegionOverlay,
    async (_event, _payload: OpenRegionOverlayRequest): Promise<RegionRect | null> => {
      try {
        return await openRegionOverlay();
      } catch (err) {
        log.error('region overlay failed', { err: String(err) });
        return null;
      }
    }
  );

  ipcMain.handle(
    IpcChannel.CaptureRunCountdown,
    async (_event, payload: RunCountdownRequest): Promise<void> => {
      if (!payload || payload.seconds <= 0) return;
      await runCountdown(payload.displayId, payload.seconds);
    }
  );

  log.info('capture handlers registered');

  // suppress unused helper warning when point-in-bounds path is unused yet
  void pointInBounds;
}
