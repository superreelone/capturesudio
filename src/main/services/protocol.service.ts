import { net, protocol } from 'electron';
import { pathToFileURL } from 'node:url';
import { resolve, normalize } from 'node:path';
import { getSettings } from './settings.store';
import { createLogger } from '@main/util/logger';

const log = createLogger('protocol');

export const LOCAL_MEDIA_SCHEME = 'local-media';

/** Must be called before app.ready. Marks our scheme as standard/secure so the renderer can fetch it. */
export function registerLocalMediaSchemeAsPrivileged(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: LOCAL_MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true
      }
    }
  ]);
}

function isUnderRoot(absPath: string, root: string): boolean {
  const a = normalize(absPath);
  const r = normalize(root);
  return a === r || a.startsWith(r + (process.platform === 'win32' ? '\\' : '/'));
}

/** Must be called after app.ready. */
export function registerLocalMediaProtocol(): void {
  protocol.handle(LOCAL_MEDIA_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      // host empty; pathname like /C:/foo/bar.webm on win32 or /home/u/foo on posix
      let p = decodeURIComponent(url.pathname);
      if (process.platform === 'win32') {
        if (p.startsWith('/')) p = p.slice(1);
      }
      const abs = resolve(p);

      const settings = getSettings();
      const allowed = [settings.outputFolder, settings.screenshotFolder];
      const allowedOk = allowed.some((root) => isUnderRoot(abs, root));
      if (!allowedOk) {
        log.warn('protocol denied (outside allowed roots)', { abs });
        return new Response('forbidden', { status: 403 });
      }

      return net.fetch(pathToFileURL(abs).toString());
    } catch (err) {
      log.error('protocol error', { err: String(err) });
      return new Response(`error: ${String(err)}`, { status: 500 });
    }
  });
  log.info('local-media protocol registered');
}
