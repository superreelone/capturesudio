import Store from 'electron-store';
import {
  buildDefaultSettings,
  PartialSettingsSchema,
  SettingsSchema,
  type PartialSettings,
  type Settings
} from '@shared/settings.schema';
import { ensureDir, getDefaultMediaPaths } from '@main/util/paths';
import { createLogger } from '@main/util/logger';

const log = createLogger('settings');

type StoreSchema = { settings: Settings };

let store: Store<StoreSchema> | null = null;

function getStore(): Store<StoreSchema> {
  if (store) return store;
  const defaults = buildDefaultSettings(getDefaultMediaPaths());
  store = new Store<StoreSchema>({
    name: 'settings',
    defaults: { settings: defaults }
  });

  const raw = store.get('settings');
  const parsed = SettingsSchema.safeParse(raw);
  if (parsed.success) {
    if (parsed.data !== raw) store.set('settings', parsed.data);
    return store;
  }

  // Schema-evolution migration: the saved object is missing fields the current
  // schema requires (or has invalid ones). Merge user values over defaults so we
  // preserve what's still valid (hotkeys, output folders, theme, etc.) instead
  // of wiping the whole settings file.
  const rawObj =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const mergedHotkeys = {
    ...defaults.hotkeys,
    ...((rawObj['hotkeys'] as Record<string, unknown> | undefined) ?? {})
  };
  const merged = {
    ...defaults,
    ...rawObj,
    hotkeys: mergedHotkeys
  };

  const reparsed = SettingsSchema.safeParse(merged);
  if (reparsed.success) {
    log.info('settings migrated: filled in missing fields from defaults', {
      missingFields: parsed.error.issues.map((i) => i.path.join('.'))
    });
    store.set('settings', reparsed.data);
  } else {
    log.warn('settings failed validation even after merge; resetting to defaults', {
      issues: reparsed.error.issues
    });
    store.set('settings', defaults);
  }
  return store;
}

export function getSettings(): Settings {
  return getStore().get('settings');
}

export function updateSettings(patch: PartialSettings): Settings {
  const safePatch = PartialSettingsSchema.parse(patch);
  const current = getSettings();
  const next = SettingsSchema.parse({ ...current, ...safePatch });
  getStore().set('settings', next);
  ensureDir(next.outputFolder);
  ensureDir(next.screenshotFolder);
  return next;
}

export function resetSettings(): Settings {
  const defaults = buildDefaultSettings(getDefaultMediaPaths());
  getStore().set('settings', defaults);
  ensureDir(defaults.outputFolder);
  ensureDir(defaults.screenshotFolder);
  return defaults;
}

export function bootstrapOutputFolders(): void {
  const s = getSettings();
  ensureDir(s.outputFolder);
  ensureDir(s.screenshotFolder);
}
