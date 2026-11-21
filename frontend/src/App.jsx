import { useEffect, useMemo, useRef, useState } from 'react'
import { Field } from './fields.jsx'
import { api, build, fmt, stepErrors, visible } from './lib.js'
const cx = (...a) => a.filter(Boolean).join(' ')

function Ring({ pct }) {
  const r = 34, c = 2 * Math.PI * r
  return (
    <svg className="ring" viewBox="0 0 80 80" aria-label={`${pct}% complete`}>
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#8b6cff" /><stop offset=".6" stopColor="#ff5fa2" /><stop offset="1" stopColor="#ffb454" /></linearGradient></defs>
      <circle cx="40" cy="40" r={r} className="trk" />
      <circle cx="40" cy="40" r={r} className="bar" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} />
      <text x="40" y="45" textAnchor="middle">{pct}%</text>
    </svg>
  )
}

function Preview({ clean, savedClean, saved, dirty, focusKey }) {
  const keys = Object.keys(clean)
  const status = !saved ? ['idle', 'Not saved yet'] : dirty ? ['dirty', 'Unsaved changes'] : ['ok', `Saved · version ${saved.version}`]
  const val = v => {
    const s = JSON.stringify(v)
    return <span className={typeof v === 'string' ? 's' : typeof v === 'number' ? 'n' : typeof v === 'boolean' ? 'b' : 'a'}>{s}</span>
  }
  return (
    <aside className="peek">
      <div className="peekhead"><span>config.json</span><em className={'st ' + status[0]}>{status[1]}</em></div>
      <pre aria-label="Live preview of config.json">
        <div className="ln">{'{'}</div>
        {keys.map((k, i) => {
          const changed = !savedClean || JSON.stringify(savedClean[k]) !== JSON.stringify(clean[k])
          return (
            <div key={k + JSON.stringify(clean[k])} className={cx('ln flash', focusKey === k && 'focus', changed && saved && 'mod')}>
              {'  '}<span className="k">"{k}"</span>: {val(clean[k])}{i < keys.length - 1 ? ',' : ''}
            </div>
          )
        })}
        <div className="ln">{'}'}</div>
      </pre>
      <p className="peekfoot">This file writes itself as you answer. It is saved to disk only when you press save on the last step.</p>
    </aside>
  )
}

export default function App() {
  const [schema, setSchema] = useState(null)
  const [values, setValues] = useState({})
  const [saved, setSaved] = useState(null)
  const [i, setI] = useState(0)
  const [visited, setVisited] = useState({})
  const [touched, setTouched] = useState({})
  const [attempt, setAttempt] = useState(false)
  const [welcome, setWelcome] = useState(true)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState(null)
  const [run, setRun] = useState(null)
  const [fatal, setFatal] = useState(null)
  const [shake, setShake] = useState(0)
  const [focusKey, setFocusKey] = useState(null)
  const term = useRef()
  const timer = useRef()

  useEffect(() => {
    Promise.all([api('/schema'), api('/config')])
      .then(([s, c]) => { setSchema(s); setValues(c.values); if (c.saved) setSaved(c) })
      .catch(e => setFatal(e.message))
    return () => clearInterval(timer.current)
  }, [])
  useEffect(() => { if (term.current) term.current.scrollTop = term.current.scrollHeight }, [run])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 5000); return () => clearTimeout(t) }, [toast])

  const steps = useMemo(() => schema ? [...schema.steps, { id: 'review', title: 'Review and launch', icon: '✓', subtitle: 'Check your answers, save the config file, and run the pipeline.' }] : [], [schema])
  const errs = useMemo(() => schema ? schema.steps.map(s => stepErrors(s, values)) : [], [schema, values])
  const clean = useMemo(() => schema ? build(schema, values) : {}, [schema, values])
  const savedClean = useMemo(() => schema && saved ? build(schema, saved.values) : null, [schema, saved])
  const dirty = !saved || JSON.stringify(clean) !== JSON.stringify(savedClean)

  if (fatal) return <div className="center"><h1>Can't reach the server</h1><p>{fatal}</p><p>Start everything with <code>./up</code>, then refresh this page.</p></div>
  if (!schema) return <div className="center"><div className="loader" /></div>

  const last = steps.length - 1
  const cur = steps[i]
  const onReview = i === last
  const problems = errs.reduce((n, e) => n + Object.keys(e).length, 0)
  const firstBad = errs.findIndex(e => Object.keys(e).length)
  const status = idx => idx === i ? 'current' : idx === last ? (saved && !dirty ? 'done' : 'todo') : !visited[idx] ? 'todo' : Object.keys(errs[idx]).length ? 'bad' : 'done'
  const doneCount = steps.filter((_, n) => status(n) === 'done').length
  const pct = Math.round((doneCount / steps.length) * 100)

  const setVal = (k, v) => setValues(o => ({ ...o, [k]: v }))
  const touch = k => setTouched(o => (o[k] ? o : { ...o, [k]: true }))
  const jump = n => { setVisited(o => ({ ...o, [i]: true })); setI(n); setAttempt(false); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const flash = (kind, title, body) => setToast({ kind, title, body })
  const next = () => {
    if (onReview) return
    if (Object.keys(errs[i]).length) {
      setAttempt(true); setShake(s => s + 1)
      setTimeout(() => document.querySelector('.field.bad')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60)
      return
    }
    jump(i + 1)
  }

  const poll = () => {
    clearInterval(timer.current)
    timer.current = setInterval(async () => {
      try { const r = await api('/run'); setRun(r); if (r.status !== 'running') clearInterval(timer.current) } catch { clearInterval(timer.current) }
    }, 600)
  }
  const start = async () => {
    setRun({ status: 'running', logs: [] })
    try { await api('/run', { method: 'POST' }); poll() } catch (e) { setRun(null); flash('err', 'Could not start the run', e.message) }
  }
  const save = async andRun => {
    setBusy(true)
    try {
      const r = await api('/config', { method: 'PUT', body: JSON.stringify({ values: clean }) })
      setSaved(r)
      flash('ok', 'Configuration saved', `Version ${r.version} was written to ${r.path}`)
      if (andRun) await start()
    } catch (e) {
      flash('err', 'Not saved', e.message)
      if (e.body?.errors) { const n = schema.steps.findIndex(s => s.fields.some(f => e.body.errors[f.key])); if (n >= 0) { setTouched(o => ({ ...o, ...Object.fromEntries(Object.keys(e.body.errors).map(k => [k, true])) })); setI(n) } }
    } finally { setBusy(false) }
  }

  // Required-answer meter for the current step
  const fields = onReview ? [] : cur.fields.filter(f => visible(f, values))
  const req = fields.filter(f => f.required)
  const reqLeft = req.filter(f => errs[i][f.key]).length
  const stepOk = !onReview && !Object.keys(errs[i]).length

  return (
    <div className="app">
      <div className="aurora" />
      <aside className="rail">
        <div className="brand"><span className="logo">✦</span><div><b>Config Studio</b><small>{schema.title}</small></div></div>
        <div className="progress"><Ring pct={pct} /><div><b>{doneCount} of {steps.length} steps done</b><small>{pct === 100 ? 'All set. Launch when ready.' : 'Follow the steps in order.'}</small></div></div>
        <nav aria-label="Steps">
          {steps.map((s, n) => {
            const st = status(n)
            return (
              <button key={s.id} className={cx('step', st)} onClick={() => jump(n)} aria-current={n === i ? 'step' : undefined}>
                <span className="dot">{st === 'done' ? '✓' : st === 'bad' ? '!' : n + 1}</span>
                <span><b>{s.title}</b><small>{st === 'current' ? 'You are here' : st === 'done' ? 'Done' : st === 'bad' ? 'Needs attention' : n === i + 1 ? 'Up next' : 'Not started'}</small></span>
              </button>
            )
          })}
        </nav>
        <p className="railfoot">Your answers stay on this page until you save. Nothing runs by accident.</p>
      </aside>

      <main className="stage" onKeyDown={e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && !['range', 'date'].includes(e.target.type) && !e.defaultPrevented) { e.preventDefault(); next() } }}>
        <header key={cur.id} className="shead">
          <span className="count">Step {i + 1} of {steps.length}</span>
          <h1>{cur.title}</h1>
          <p>{cur.subtitle}</p>
        </header>

        {!onReview && (
          <div className={cx('guide', stepOk && 'ok')}>
            <span className="gico">{stepOk ? '✓' : '→'}</span>
            <div>
              <b>{!req.length ? 'Nothing is required here.' : stepOk ? 'All required answers are in.' : `${reqLeft} required ${reqLeft === 1 ? 'answer' : 'answers'} left on this step.`}</b>
              <small>{stepOk ? 'Press Continue (or Enter) to move on.' : !req.length ? 'The defaults are already sensible. Change only what you need.' : 'Fields marked Required must be filled before you can continue.'}</small>
            </div>
            {!!req.length && <div className="meter">{req.map(f => <i key={f.key} className={errs[i][f.key] ? '' : 'on'} />)}</div>}
          </div>
        )}

        {attempt && !stepOk && !onReview && <div key={shake} className="alert shake" role="alert"><b>Almost there.</b> Fix the {Object.keys(errs[i]).length} highlighted {Object.keys(errs[i]).length === 1 ? 'field' : 'fields'} below, then continue.</div>}

        {!onReview && (
          <div className="fields" key={cur.id}>
            {fields.map(f => <Field key={f.key} f={f} value={values[f.key]} onChange={setVal} error={errs[i][f.key]} show={touched[f.key] || attempt} onTouch={touch} onFocusKey={setFocusKey} />)}
          </div>
        )}

        {onReview && (
          <div className="review">
            {problems > 0 && (
              <div className="alert" role="alert">
                <b>{problems} {problems === 1 ? 'thing needs' : 'things need'} fixing before you can save.</b>
                <button className="btn small" onClick={() => jump(firstBad)}>Take me to the first one</button>
              </div>
            )}
            {schema.steps.map((s, n) => (
              <section className="rsec" key={s.id}>
                <div className="rhead"><h3>{s.title}</h3>{Object.keys(errs[n]).length ? <span className="pill bad">{Object.keys(errs[n]).length} to fix</span> : null}<button className="link" onClick={() => jump(n)}>Edit</button></div>
                <dl>{s.fields.filter(f => visible(f, values)).map(f => (
                  <div key={f.key} className={errs[n][f.key] ? 'bad' : ''}><dt>{f.label}</dt><dd>{errs[n][f.key] ? errs[n][f.key] : fmt(f, values[f.key])}</dd></div>
                ))}</dl>
              </section>
            ))}
            <section className="launch">
              <h3>{saved && !dirty ? 'Saved. Ready to run.' : saved ? 'You have unsaved changes' : 'Last step: save and launch'}</h3>
              <p>{saved && !dirty ? <>Your config is on disk at <code>./data/config.json</code> (version {saved.version}). <a href="/api/config/download">Download it</a></> : 'Saving writes config.json and records this version in the database. The pipeline reads only that file.'}</p>
              <div className="btns">
                <button className="btn ghosty" disabled={busy || problems > 0 || (saved && !dirty)} onClick={() => save(false)}>{busy ? 'Saving…' : 'Save configuration'}</button>
                <button className="btn primary ready" disabled={busy || problems > 0 || run?.status === 'running'} onClick={() => (dirty ? save(true) : start())}>{run?.status === 'running' ? 'Running…' : dirty ? 'Save and run pipeline' : 'Run pipeline'}</button>
              </div>
              {problems > 0 && <small className="why">Buttons unlock when every step is complete.</small>}
            </section>
            {run && (
              <section className="term" aria-live="polite">
                <div className="thead"><i /><i /><i /><span>Pipeline output</span><em className={'st ' + run.status}>{run.status === 'running' ? 'Running' : run.status === 'done' ? 'Finished' : run.status}</em></div>
                <div className="tbody" ref={term}>{run.logs.length ? run.logs.map((l, n) => <div key={n} className={'l ' + (l.split(/\s+/)[1] || '').toLowerCase()}>{l}</div>) : <div className="l">Starting…</div>}</div>
              </section>
            )}
          </div>
        )}

        <footer className="nav">
          <button className="btn ghosty" onClick={() => jump(i - 1)} disabled={i === 0}>Back</button>
          <span className="hint">{onReview ? '' : 'Tip: press Enter to continue'}</span>
          {!onReview && <button className={cx('btn primary', stepOk && 'ready')} onClick={next}>{i === last - 1 ? 'Review everything' : 'Continue'}</button>}
        </footer>
      </main>

      <Preview clean={clean} savedClean={savedClean} saved={saved} dirty={dirty} focusKey={focusKey} />

      {toast && <div className={cx('toast', toast.kind)} role="status"><b>{toast.title}</b><span>{toast.body}</span></div>}

      {welcome && (
        <div className="welcome" role="dialog" aria-modal="true" aria-labelledby="wt">
          <div className="wbox">
            <span className="logo big">✦</span>
            <h1 id="wt">Let's set up {schema.title}</h1>
            <p>{saved ? `Welcome back. Your last saved settings (version ${saved.version}) are already loaded.` : schema.subtitle}</p>
            <ol>
              <li><b>Answer</b><span>Go through {schema.steps.length} short steps. Every field explains itself.</span></li>
              <li><b>Watch</b><span>The config.json panel on the right fills in as you go.</span></li>
              <li><b>Launch</b><span>Save once, then run. The program reads only the saved file.</span></li>
            </ol>
            <button className="btn primary ready big" autoFocus onClick={() => setWelcome(false)}>Start setup</button>
          </div>
        </div>
      )}
    </div>
  )
}
