import { app } from 'electron';
import {
  createWriteStream,
  promises as fsp,
  statSync,
  type WriteStream
} from 'node:fs';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { renderFilenameTemplate } from '@shared/filename-template';
import { getSettings } from '@main/services/settings.store';
import { nextCounter } from '@main/services/counter.store';
import { ensureDir, getTempRecordingDir } from '@main/util/paths';
import { createLogger } from '@main/util/logger';
import type {
  FinalizeRecordingRequest,
  FinalizeRecordingResponse,
  StartRecordingRequest,
  StartRecordingResponse
} from '@shared/recording.types';

const log = createLogger('recording');

interface Session {
  id: string;
  tempPath: string;
  stream: WriteStream;
  startedAt: number;
  bytes: number;
  request: StartRecordingRequest;
  drainPromise: Promise<void> | null;
}

const sessions = new Map<string, Session>();

export function startSession(req: StartRecordingRequest): StartRecordingResponse {
  const id = randomUUID();
  const dir = getTempRecordingDir();
  const tempPath = join(dir, `session-${id}.${req.ext}`);
  const stream = createWriteStream(tempPath, { flags: 'w' });
  stream.on('error', (err) =>
    log.error('temp stream error', { sessionId: id, err: String(err) })
  );
  sessions.set(id, {
    id,
    tempPath,
    stream,
    startedAt: Date.now(),
    bytes: 0,
    request: req,
    drainPromise: null
  });
  log.info('recording session started', { sessionId: id, tempPath, kind: req.kind });
  return { sessionId: id, tempPath };
}

export function appendChunk(sessionId: string, data: Uint8Array): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return Promise.reject(new Error(`unknown recording session: ${sessionId}`));
  session.bytes += data.byteLength;
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const ok = session.stream.write(buf);
  if (ok) return Promise.resolve();
  if (!session.drainPromise) {
    session.drainPromise = new Promise<void>((resolve) => {
      session.stream.once('drain', () => {
        session.drainPromise = null;
        resolve();
      });
    });
  }
  return session.drainPromise;
}

async function closeStream(session: Session): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    session.stream.end((err?: NodeJS.ErrnoException | null) =>
      err ? reject(err) : resolve()
    );
  });
}

export async function finalizeSession(
  req: FinalizeRecordingRequest
): Promise<FinalizeRecordingResponse> {
  const session = sessions.get(req.sessionId);
  if (!session) throw new Error(`unknown recording session: ${req.sessionId}`);

  await closeStream(session);

  const settings = getSettings();
  const outputDir = settings.outputFolder;
  ensureDir(outputDir);

  const counter = nextCounter('recording');
  const filename = renderFilenameTemplate(settings.filenameTemplate, {
    app: 'Ingestra-CaptureStudio',
    type: 'recording',
    source: req.sourceLabel,
    ext: session.request.ext,
    counter,
    date: new Date()
  });

  let finalPath = join(outputDir, filename);
  finalPath = await ensureUniquePath(finalPath);

  await fsp.rename(session.tempPath, finalPath).catch(async (err) => {
    if (err && (err as NodeJS.ErrnoException).code === 'EXDEV') {
      await fsp.copyFile(session.tempPath, finalPath);
      await fsp.unlink(session.tempPath).catch(() => undefined);
    } else {
      throw err;
    }
  });

  const sizeBytes = statSync(finalPath).size;
  sessions.delete(req.sessionId);
  log.info('recording finalized', {
    sessionId: req.sessionId,
    finalPath,
    sizeBytes,
    durationMs: req.durationMs
  });

  return {
    finalPath,
    filename: basename(finalPath),
    sizeBytes,
    durationMs: req.durationMs
  };
}

export async function cancelSession(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;
  try {
    await closeStream(session);
  } catch {
    // ignore
  }
  await fsp.unlink(session.tempPath).catch(() => undefined);
  sessions.delete(sessionId);
  log.info('recording cancelled', { sessionId });
}

async function ensureUniquePath(path: string): Promise<string> {
  try {
    await fsp.access(path);
  } catch {
    return path;
  }
  const dot = path.lastIndexOf('.');
  const stem = dot >= 0 ? path.slice(0, dot) : path;
  const ext = dot >= 0 ? path.slice(dot) : '';
  let i = 1;
  while (i < 9999) {
    const candidate = `${stem} (${i})${ext}`;
    try {
      await fsp.access(candidate);
    } catch {
      return candidate;
    }
    i++;
  }
  return `${stem}-${Date.now()}${ext}`;
}

export async function cleanupTempOnQuit(): Promise<void> {
  for (const session of sessions.values()) {
    try {
      await closeStream(session);
    } catch {
      // ignore
    }
    await fsp.unlink(session.tempPath).catch(() => undefined);
  }
  sessions.clear();
}

void app; // referenced for side-effect type only
