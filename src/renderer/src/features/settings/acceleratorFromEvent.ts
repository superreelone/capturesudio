// Map a KeyboardEvent into an Electron accelerator string.
// Returns null if only modifiers are pressed (no main key yet).

const KEY_NAME: Record<string, string> = {
  ' ': 'Space',
  Spacebar: 'Space',
  Escape: 'Esc',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Enter: 'Return',
  Backspace: 'Backspace',
  Tab: 'Tab',
  PrintScreen: 'PrintScreen',
  Insert: 'Insert',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown'
};

const MODIFIER_KEYS = new Set([
  'Control',
  'Shift',
  'Alt',
  'Meta',
  'ControlLeft',
  'ControlRight',
  'ShiftLeft',
  'ShiftRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
  'OS'
]);

export function acceleratorFromEvent(e: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null;

  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');

  let main: string | null = null;

  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(e.key)) {
    main = e.key;
  } else if (KEY_NAME[e.key]) {
    main = KEY_NAME[e.key]!;
  } else if (e.key.length === 1) {
    main = e.key.toUpperCase();
  } else if (e.code && e.code.startsWith('Key')) {
    main = e.code.slice(3);
  } else if (e.code && e.code.startsWith('Digit')) {
    main = e.code.slice(5);
  }

  if (!main) return null;
  parts.push(main);
  return parts.join('+');
}
