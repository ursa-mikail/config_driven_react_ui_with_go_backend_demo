export const visible = (f, v) => {
  if (!f.showIf) return true
  const have = String(v[f.showIf.key])
  return f.showIf.in ? f.showIf.in.map(String).includes(have) : have === String(f.showIf.equals)
}
const empty = x => x == null || (typeof x === 'string' && !x.trim())

// Mirrors the server's rules so people see problems instantly. The server re-checks everything.
export function check(f, x) {
  const t = f.type
  if (t === 'toggle' || t === 'checkbox') return f.required && !x ? 'Tick this box to continue.' : ''
  if (t === 'tags' && x && x.length > 20) return 'Use at most 20 labels.'
  if (t === 'multicheck' || t === 'tags') return f.required && !(x && x.length) ? 'Choose at least one.' : ''
  if (empty(x)) return f.required ? (t === 'number' ? 'Enter a number.' : t === 'select' || t === 'radio' ? 'Pick one option.' : 'This field is required.') : ''
  if (t === 'number' || t === 'slider') {
    if (typeof x !== 'number' || Number.isNaN(x)) return 'Enter a number.'
    if (f.min != null && x < f.min) return `Must be at least ${f.min}.`
    if (f.max != null && x > f.max) return `Must be at most ${f.max}.`
    if (f.step > 0) { const q = (x - (f.min ?? 0)) / f.step; if (Math.abs(q - Math.round(q)) > 1e-6) return `Use steps of ${f.step}.` }
    return ''
  }
  if (typeof x === 'string' && x.trim().length > 2000) return 'Too long (2000 characters at most).'
  if (t === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(x) || Number.isNaN(Date.parse(x)))) return 'Enter a real date.'
  if (f.pattern && !new RegExp(f.pattern).test(String(x).trim())) return f.patternMsg || 'That does not look right.'
  return ''
}

// The answers a brand-new config starts with, taken from each field's default.
export const defaults = schema =>
  Object.fromEntries(schema.steps.flatMap(s => s.fields).filter(f => f.default !== undefined).map(f => [f.key, f.default]))

export const when = iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) }

export const stepErrors = (step, v) =>
  Object.fromEntries(step.fields.filter(f => visible(f, v)).map(f => [f.key, check(f, v[f.key])]).filter(([, m]) => m))

// Only visible fields with a value end up in the config file.
export function build(schema, v) {
  const out = {}
  for (const s of schema.steps) for (const f of s.fields) {
    if (!visible(f, v)) continue
    const x = v[f.key]
    if (x === undefined || x === null || x === '') continue
    out[f.key] = x
  }
  return out
}

export function fmt(f, v) {
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return 'Not set'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (f.type === 'password') return '••••••••'
  if (Array.isArray(v)) return v.map(x => f.options?.find(o => o.value === x)?.label || x).join(', ')
  const o = f.options?.find(o => o.value === v)
  if (o) return o.label
  return f.unit ? `${v} ${f.unit}` : String(v)
}

export async function api(path, opt = {}) {
  const r = await fetch('/api' + path, { headers: { 'Content-Type': 'application/json' }, ...opt })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw Object.assign(new Error(j.error || 'Something went wrong talking to the server.'), { status: r.status, body: j })
  return j
}
