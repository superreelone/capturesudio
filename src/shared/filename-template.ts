export interface TemplateContext {
  app: string;
  type: 'recording' | 'screenshot';
  source: string;
  ext: string;
  counter: number;
  date: Date;
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

function sanitize(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

export function renderFilenameTemplate(template: string, ctx: TemplateContext): string {
  const d = ctx.date;
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1, 2);
  const day = pad(d.getDate(), 2);
  const hours = pad(d.getHours(), 2);
  const minutes = pad(d.getMinutes(), 2);
  const seconds = pad(d.getSeconds(), 2);

  const tokens: Record<string, string> = {
    '{app}': sanitize(ctx.app),
    '{type}': ctx.type,
    '{source}': sanitize(ctx.source),
    '{date}': `${year}-${month}-${day}`,
    '{time}': `${hours}${minutes}${seconds}`,
    '{year}': String(year),
    '{month}': month,
    '{day}': day,
    '{hour}': hours,
    '{minute}': minutes,
    '{second}': seconds,
    '{counter}': pad(ctx.counter, 4)
  };

  let body = template;
  for (const [token, value] of Object.entries(tokens)) {
    body = body.split(token).join(value);
  }

  const safe = sanitize(body) || 'capture';
  return `${safe}.${ctx.ext}`;
}
