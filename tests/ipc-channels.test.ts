import { describe, expect, it } from 'vitest';
import { IpcChannel, IpcEvent } from '../src/shared/ipc-channels';

describe('IpcChannel', () => {
  it('all channel values are unique', () => {
    const values = Object.values(IpcChannel);
    expect(new Set(values).size).toBe(values.length);
  });

  it('all channels use namespace:method form', () => {
    for (const v of Object.values(IpcChannel)) {
      expect(v).toMatch(/^[a-z]+:[A-Za-z]+$/);
    }
  });

  it('no channel collides with an event name', () => {
    const channelSet = new Set(Object.values(IpcChannel));
    const eventSet = new Set(Object.values(IpcEvent));
    for (const e of eventSet) {
      expect(channelSet.has(e as unknown as IpcChannel[keyof typeof IpcChannel])).toBe(false);
    }
  });
});

describe('IpcEvent', () => {
  it('all event values are unique', () => {
    const values = Object.values(IpcEvent);
    expect(new Set(values).size).toBe(values.length);
  });

  it('all event values start with evt:', () => {
    for (const v of Object.values(IpcEvent)) {
      expect(v.startsWith('evt:')).toBe(true);
    }
  });
});
