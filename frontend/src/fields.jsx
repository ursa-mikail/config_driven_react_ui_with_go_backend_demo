import { useEffect, useRef, useState } from 'react'
import { fmt } from './lib.js'
const cx = (...a) => a.filter(Boolean).join(' ')

function Text({ f, value, onChange, bad }) {
  const [show, setShow] = useState(false)
  const pw = f.type === 'password'
  return (
    <div className={cx('input', bad && 'bad')}>
      <input id={f.key} type={pw && !show ? 'password' : 'text'} value={value ?? ''} placeholder={f.placeholder}
        autoComplete="off" spellCheck={false} onChange={e => onChange(e.target.value)} />
      {pw && <button type="button" className="ghost" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button>}
    </div>
  )
}

function Area({ f, value, onChange }) {
  return <div className="input"><textarea id={f.key} rows={3} value={value ?? ''} placeholder={f.placeholder} onChange={e => onChange(e.target.value)} /></div>
}

function Num({ f, value, onChange, bad }) {
  const step = f.step || 1
  const nudge = d => onChange(Math.min(f.max ?? Infinity, Math.max(f.min ?? -Infinity, (value || 0) + d * step)))
  return (
    <div className="numrow">
      <div className={cx('input num', bad && 'bad')}>
        <button type="button" className="ghost" aria-label="Decrease" onClick={() => nudge(-1)}>−</button>
        <input id={f.key} type="number" value={value ?? ''} min={f.min} max={f.max} step={step}
          onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} />
        <button type="button" className="ghost" aria-label="Increase" onClick={() => nudge(1)}>+</button>
      </div>
      <span className="range">Allowed: {f.min} to {f.max}</span>
    </div>
  )
}

function Slider({ f, value, onChange }) {
  const v = value ?? f.min
  const p = ((v - f.min) / (f.max - f.min)) * 100
  return (
    <div className="slider" style={{ '--p': p + '%' }}>
      <div className="bubble" style={{ left: `calc(${p}% + ${10 - p * 0.2}px)` }}>{v}<span> {f.unit}</span></div>
      <input id={f.key} type="range" min={f.min} max={f.max} step={f.step} value={v} onChange={e => onChange(Number(e.target.value))} />
      <div className="ends"><span>{f.min}</span><span>{f.max}</span></div>
    </div>
  )
}

function Select({ f, value, onChange, bad }) {
  const [open, setOpen] = useState(false)
  const [up, setUp] = useState(false)
  const [act, setAct] = useState(0)
  const ref = useRef()
  const list = useRef()
  const idx = f.options.findIndex(o => o.value === value)
  const cur = f.options[idx]

  const show = () => {
    // Open upward when there is not enough room below (the sticky bottom bar takes ~90px).
    const r = ref.current.getBoundingClientRect()
    const need = Math.min(f.options.length * 62 + 16, 320)
    const below = window.innerHeight - r.bottom - 100
    setUp(below < need && r.top > below)
    setAct(Math.max(idx, 0))
    setOpen(true)
  }
  const pick = o => { onChange(o.value); setOpen(false); ref.current.querySelector('button').focus() }

  useEffect(() => {
    if (!open) return
    const h = e => { if (!ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])
  useEffect(() => {
    if (open) list.current?.children[act]?.scrollIntoView({ block: 'nearest' })
  }, [open, act])

  const n = f.options.length
  const key = e => {
    if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false) }
    else if (e.key === 'ArrowDown') { e.preventDefault(); open ? setAct((act + 1) % n) : show() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); open ? setAct((act - 1 + n) % n) : show() }
    else if (e.key === 'Home' && open) { e.preventDefault(); setAct(0) }
    else if (e.key === 'End' && open) { e.preventDefault(); setAct(n - 1) }
    else if ((e.key === 'Enter' || e.key === ' ') && open) { e.preventDefault(); e.stopPropagation(); pick(f.options[act]) }
    else if (e.key === 'Tab') setOpen(false)
  }
  return (
    <div className="select" ref={ref} onKeyDown={key}>
      <button type="button" id={f.key} className={cx('input selbtn', bad && 'bad', open && 'open')} aria-haspopup="listbox" aria-expanded={open}
        aria-controls={f.key + '-list'} onClick={() => (open ? setOpen(false) : show())}>
        <span>{cur ? <><b>{cur.label}</b><i>{cur.desc}</i></> : <em>Choose an option…</em>}</span><span className="chev">⌄</span>
      </button>
      {open && (
        <ul role="listbox" id={f.key + '-list'} ref={list} className={cx('pop', up && 'up')} aria-activedescendant={f.key + '-' + act}>
          {f.options.map((o, k) => (
            <li key={o.value} id={f.key + '-' + k} role="option" aria-selected={o.value === value}
              className={cx(o.value === value && 'on', k === act && 'act')} onMouseEnter={() => setAct(k)} onClick={() => pick(o)}>
              <b>{o.label}</b><i>{o.desc}</i>{o.value === value && <span className="tick">✓</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Radio({ f, value, onChange }) {
  return (
    <div className="cards" role="radiogroup" aria-label={f.label}>
      {f.options.map(o => (
        <button type="button" role="radio" aria-checked={o.value === value} key={o.value} className={cx('card', o.value === value && 'on')} onClick={() => onChange(o.value)}>
          {o.icon && <span className="ico">{o.icon}</span>}<b>{o.label}</b><i>{o.desc}</i>
          {f.recommended === o.value && <span className="rec">Recommended</span>}
        </button>
      ))}
    </div>
  )
}

function Multi({ f, value, onChange }) {
  const v = value || []
  const flip = x => onChange(v.includes(x) ? v.filter(y => y !== x) : [...v, x])
  return (
    <div className="cards multi" role="group" aria-label={f.label}>
      {f.options.map(o => (
        <button type="button" key={o.value} role="checkbox" aria-checked={v.includes(o.value)} className={cx('card', v.includes(o.value) && 'on')} onClick={() => flip(o.value)}>
          <span className="box">{v.includes(o.value) ? '✓' : ''}</span><b>{o.label}</b><i>{o.desc}</i>
        </button>
      ))}
    </div>
  )
}

const SW = ['#7c5cff', '#4de1d0', '#ff5fa2', '#ffb454', '#6ee77a', '#4da3ff', '#ff6b6b', '#e5e5ff']
function Color({ value, onChange }) {
  return (
    <div className="swatches">
      {SW.map(c => <button type="button" key={c} aria-label={c} className={cx('sw', value === c && 'on')} style={{ background: c }} onClick={() => onChange(c)} />)}
      <label className="sw custom" title="Pick any color"><input type="color" value={value || '#7c5cff'} onChange={e => onChange(e.target.value)} /><span>+</span></label>
      <code>{value}</code>
    </div>
  )
}

function Tags({ f, value, onChange }) {
  const [t, setT] = useState('')
  const v = value || []
  const add = () => { const s = t.trim().toLowerCase(); if (s && !v.includes(s)) onChange([...v, s]); setT('') }
  return (
    <div className="input tags">
      {v.map(x => <span className="chip" key={x}>{x}<button type="button" aria-label={'Remove ' + x} onClick={() => onChange(v.filter(y => y !== x))}>×</button></span>)}
      <input id={f.key} value={t} placeholder={v.length ? 'Add another…' : 'Type a label, press Enter'} onChange={e => setT(e.target.value)} onBlur={add}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); add() }
          if (e.key === 'Backspace' && !t && v.length) onChange(v.slice(0, -1))
        }} />
    </div>
  )
}

function DateIn({ f, value, onChange }) {
  return (
    <div className="input">
      <input id={f.key} type="date" value={value || ''} onChange={e => onChange(e.target.value)} />
      {value && <button type="button" className="ghost" onClick={() => onChange('')}>Clear</button>}
    </div>
  )
}

const Switch = ({ value, onChange, label }) => (
  <button type="button" role="switch" aria-label={label} aria-checked={!!value} className={cx('switch', value && 'on')} onClick={() => onChange(!value)}>
    <span className="knob" /><span className="sw-t">{value ? 'On' : 'Off'}</span>
  </button>
)
const Check = ({ value, onChange, label }) => (
  <button type="button" role="checkbox" aria-label={label} aria-checked={!!value} className={cx('check', value && 'on')} onClick={() => onChange(!value)}>{value ? '✓' : ''}</button>
)

export function Field({ f, value, onChange, error, show, onTouch, onFocusKey }) {
  const bad = show && !!error
  const good = show && !error && f.required
  const p = { f, value, onChange: v => { onChange(f.key, v); onTouch(f.key) }, bad }
  const row = f.type === 'toggle' || f.type === 'checkbox'
  const ctl = {
    text: <Text {...p} />, password: <Text {...p} />, textarea: <Area {...p} />, number: <Num {...p} />, slider: <Slider {...p} />,
    select: <Select {...p} />, radio: <Radio {...p} />, multicheck: <Multi {...p} />, color: <Color {...p} />, tags: <Tags {...p} />, date: <DateIn {...p} />,
    toggle: <Switch value={value} onChange={p.onChange} label={f.label} />, checkbox: <Check value={value} onChange={p.onChange} label={f.label} />,
  }[f.type]
  const showRec = f.recommended !== undefined && JSON.stringify(value) !== JSON.stringify(f.recommended) && f.type !== 'radio'
  const recText = f.type === 'toggle' || f.type === 'checkbox' ? (f.recommended ? 'On' : 'Off') : fmt(f, f.recommended)
  const head = (
    <div className="fhead">
      <label htmlFor={f.key}>{f.label}</label>
      <span className={cx('pill', f.required ? 'req' : 'opt', good && 'ok')}>{good ? '✓ Looks good' : f.required ? 'Required' : 'Optional'}</span>
    </div>
  )
  const rest = (
    <>
      {f.help && <p className="help">{f.help}</p>}
      {bad && <p className="err" role="alert"><b>!</b> {error}</p>}
    </>
  )
  const rec = showRec && <button type="button" className="reclink" onClick={() => p.onChange(f.recommended)}>Use the recommended setting: {recText}</button>
  return (
    <section className={cx('field', row && 'rowfield', bad && 'bad')} data-key={f.key} onBlur={() => onTouch(f.key)} onFocus={() => onFocusKey(f.key)}>
      {row ? <>{ctl}<div className="rowtext">{head}{rest}{rec}</div></> : <>{head}{rest}{ctl}{rec}</>}
    </section>
  )
}
