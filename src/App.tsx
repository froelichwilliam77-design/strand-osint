import { useEffect, useMemo, useRef, useState } from 'react'
import { ControlPanel } from '@/components/ControlPanel'
import { Metrics, Results, type Tab } from '@/components/Workspace'
import {
  defaultOptions,
  peekSeedKind,
  type FormResult,
  type IntelResult,
  type LogEvent,
  type ProbeResult,
  type SeedResult,
  type SpiderEvent,
  type SpiderOptions,
  type SpiderStats,
} from '@/lib/utils'

const emptyStats = (): SpiderStats => ({ probed: 0, forms: 0, scripts: 0, intel: 0, queued: 0, skipped: 0 })

export default function App() {
  const [options, setOptions] = useState<SpiderOptions>(defaultOptions)
  const [tab, setTab] = useState<Tab>('Endpoints')
  const [running, setRunning] = useState(false)
  const [statusLabel, setStatusLabel] = useState('Awaiting seed')
  const [stats, setStats] = useState<SpiderStats>(emptyStats)
  const [probes, setProbes] = useState<ProbeResult[]>([])
  const [forms, setForms] = useState<FormResult[]>([])
  const [seeds, setSeeds] = useState<SeedResult[]>([])
  const [intel, setIntel] = useState<IntelResult[]>([])
  const [scripts, setScripts] = useState<string[]>([])
  const [logs, setLogs] = useState<LogEvent[]>([])
  const [selected, setSelected] = useState<ProbeResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const jobRef = useRef<string | null>(null)
  const sourceRef = useRef<EventSource | null>(null)
  const genRef = useRef(0)
  const queueRef = useRef<SpiderEvent[]>([])
  const flushRef = useRef<number | null>(null)
  const terminalRef = useRef(false)

  const uniqueIntel = useMemo(
    () => uniqueKey(intel, (i) => `${i.type}:${i.site ?? ''}:${i.value.toLowerCase()}:${i.url ?? ''}:${i.source}`),
    [intel],
  )
  const uniqueScripts = useMemo(() => [...new Set(scripts)], [scripts])
  const uniqueSeeds = useMemo(() => uniqueKey(seeds, (s) => `${s.kind}:${s.url}`), [seeds])

  useEffect(() => {
    return () => {
      sourceRef.current?.close()
      if (flushRef.current) cancelAnimationFrame(flushRef.current)
    }
  }, [])

  const reset = () => {
    setProbes([])
    setForms([])
    setSeeds([])
    setIntel([])
    setScripts([])
    setLogs([])
    setSelected(null)
    setStats(emptyStats())
    setError(null)
    queueRef.current = []
    terminalRef.current = false
  }

  const stop = async () => {
    genRef.current += 1
    sourceRef.current?.close()
    sourceRef.current = null
    if (jobRef.current) {
      await fetch(`/api/spider/${jobRef.current}/stop`, { method: 'POST' }).catch(() => undefined)
    }
    setRunning(false)
  }

  const flush = () => {
    flushRef.current = null
    const batch = queueRef.current
    if (!batch.length) return
    queueRef.current = []
    applyBatch(batch)
  }

  const enqueue = (event: SpiderEvent) => {
    queueRef.current.push(event)
    if (flushRef.current == null) {
      flushRef.current = requestAnimationFrame(flush)
    }
  }

  const applyBatch = (batch: SpiderEvent[]) => {
    const nextProbes: ProbeResult[] = []
    const nextForms: FormResult[] = []
    const nextSeeds: SeedResult[] = []
    const nextIntel: IntelResult[] = []
    const nextScripts: string[] = []
    const nextLogs: LogEvent[] = []
    let lastStatus: Extract<SpiderEvent, { type: 'status' }> | null = null
    let lastError: string | null = null

    for (const event of batch) {
      if (event.type === 'probe') nextProbes.push(event.probe)
      else if (event.type === 'form') nextForms.push(event.form)
      else if (event.type === 'seed') nextSeeds.push(event.seed)
      else if (event.type === 'intel') nextIntel.push(event.intel)
      else if (event.type === 'script') nextScripts.push(event.url)
      else if (event.type === 'log') nextLogs.push(event.log)
      else if (event.type === 'status') lastStatus = event
      else if (event.type === 'error') lastError = event.message
    }

    if (nextProbes.length) setProbes((prev) => nextProbes.reduce(upsertProbe, prev))
    if (nextForms.length) setForms((prev) => [...prev, ...nextForms])
    if (nextSeeds.length) setSeeds((prev) => [...prev, ...nextSeeds])
    if (nextIntel.length) setIntel((prev) => [...prev, ...nextIntel])
    if (nextScripts.length) setScripts((prev) => [...prev, ...nextScripts])
    if (nextLogs.length) setLogs((prev) => [...prev, ...nextLogs])
    if (lastError) setError(lastError)
    if (lastStatus) {
      setStats(lastStatus.stats)
      if (lastStatus.status === 'running') setStatusLabel(lastStatus.message || `Probing (${lastStatus.stats.probed})`)
      if (lastStatus.status === 'done') {
        terminalRef.current = true
        setStatusLabel(lastStatus.message || `Complete — ${lastStatus.stats.probed} URLs`)
        setRunning(false)
        sourceRef.current?.close()
      }
      if (lastStatus.status === 'stopped') {
        terminalRef.current = true
        setStatusLabel('Stopped')
        setRunning(false)
        sourceRef.current?.close()
      }
      if (lastStatus.status === 'error') {
        terminalRef.current = true
        setStatusLabel('Error')
        setError(lastStatus.message ?? 'Job failed')
        setRunning(false)
        sourceRef.current?.close()
      }
    }
  }

  const connectEvents = (jobId: string, gen: number, attempt = 0) => {
    if (genRef.current !== gen) return
    sourceRef.current?.close()
    const source = new EventSource(`/api/spider/${jobId}/events`)
    sourceRef.current = source
    source.onmessage = (message) => {
      if (genRef.current !== gen) return
      try {
        enqueue(JSON.parse(message.data) as SpiderEvent)
      } catch {
        /* ignore malformed frames */
      }
    }
    source.onerror = () => {
      source.close()
      if (genRef.current !== gen || terminalRef.current) return
      if (attempt >= 6) {
        void recoverSnapshot(jobId, gen)
        return
      }
      window.setTimeout(() => {
        if (genRef.current !== gen || terminalRef.current) return
        resetCollections()
        connectEvents(jobId, gen, attempt + 1)
      }, Math.min(400 * 2 ** attempt, 4000))
    }
  }

  const resetCollections = () => {
    setProbes([])
    setForms([])
    setSeeds([])
    setIntel([])
    setScripts([])
    setLogs([])
    setStats(emptyStats())
  }

  const recoverSnapshot = async (jobId: string, gen: number) => {
    if (genRef.current !== gen || terminalRef.current) return
    try {
      const res = await fetch(`/api/spider/${jobId}`)
      if (genRef.current !== gen) return
      if (res.status === 404) {
        setError('Lost job stream (job expired or server restarted)')
        setRunning(false)
        setStatusLabel('Disconnected')
        return
      }
      if (!res.ok) throw new Error('snapshot failed')
      const snap = (await res.json()) as { status: string; events: SpiderEvent[] }
      resetCollections()
      applyBatch(snap.events)
      if (snap.status === 'running') {
        connectEvents(jobId, gen, 6)
        return
      }
      terminalRef.current = true
      setRunning(false)
    } catch {
      setError('Connection lost. Stop and re-run if the job is still going.')
      setRunning(false)
      setStatusLabel('Disconnected')
    }
  }

  const run = async () => {
    await stop()
    const gen = genRef.current
    reset()
    setRunning(true)
    const kind = peekSeedKind(options.target)
    setStatusLabel(kind === 'url' || kind === 'unknown' ? 'Starting…' : `Starting ${kind} OSINT…`)
    if (kind === 'email' || kind === 'username' || kind === 'phone') setTab('Intel')
    try {
      const res = await fetch('/api/spider', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(options),
      })
      const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string }
      if (genRef.current !== gen) return
      if (!res.ok || !body.id) {
        throw new Error(body.error || 'Could not start job')
      }
      jobRef.current = body.id
      connectEvents(body.id, gen)
    } catch (err) {
      if (genRef.current !== gen) return
      setRunning(false)
      setError(err instanceof Error ? err.message : String(err))
      setStatusLabel('Blocked')
    }
  }

  return (
    <div className="min-h-svh bg-ink px-3 py-4 text-ink-2 md:px-6 md:py-5">
      <header className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center">
        <Logo />
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted">OSINT Spider</div>
          <h1 className="text-2xl font-semibold tracking-tight">STRAND</h1>
          <p className="max-w-2xl text-sm text-muted">
            Active and semi-passive recon: seed discovery, DOM link extraction, MIME and header inspection. Paste a URL,
            email, username, or phone.
          </p>
        </div>
      </header>
      {error ? (
        <div className="mb-4 rounded-xl border border-[#5a3030] bg-[#241616] px-3 py-3 text-sm text-[#f0c7c7]">{error}</div>
      ) : null}
      <div className="strand-shell flex flex-col gap-4 lg:h-[calc(100svh-9.5rem)] lg:flex-row">
        <div className="strand-sidebar w-full shrink-0 lg:h-full lg:w-[340px]">
          <ControlPanel options={options} running={running} onChange={setOptions} onRun={run} onStop={stop} />
        </div>
        <div className="strand-results flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          <Metrics stats={stats} uniqueIntel={uniqueIntel.length} uniqueScripts={uniqueScripts.length} running={running} />
          <Results
            tab={tab}
            onTab={setTab}
            statusLabel={statusLabel}
            probes={probes}
            forms={forms}
            seeds={uniqueSeeds}
            intel={uniqueIntel}
            logs={logs}
            selected={selected}
            onSelect={setSelected}
            running={running}
          />
        </div>
      </div>
    </div>
  )
}

function Logo() {
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-sage text-[#1a2214]">
      <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden="true">
        <circle cx="16" cy="16" r="2.2" fill="currentColor" />
        <circle cx="16" cy="6.5" r="1.5" fill="currentColor" />
        <circle cx="16" cy="25.5" r="1.5" fill="currentColor" />
        <circle cx="6.5" cy="16" r="1.5" fill="currentColor" />
        <circle cx="25.5" cy="16" r="1.5" fill="currentColor" />
        <circle cx="9.2" cy="9.2" r="1.4" fill="currentColor" />
        <circle cx="22.8" cy="9.2" r="1.4" fill="currentColor" />
        <circle cx="9.2" cy="22.8" r="1.4" fill="currentColor" />
        <circle cx="22.8" cy="22.8" r="1.4" fill="currentColor" />
        <path
          d="M16 14V8M16 18v6M14 16H8M18 16h6M14.4 14.4 10.3 10.3M17.6 14.4l4.1-4.1M14.4 17.6l-4.1 4.1M17.6 17.6l4.1 4.1"
          stroke="currentColor"
          strokeWidth="1.35"
          strokeLinecap="round"
        />
      </svg>
    </div>
  )
}

function upsertProbe(list: ProbeResult[], probe: ProbeResult): ProbeResult[] {
  const idx = list.findIndex((p) => p.url === probe.url)
  if (idx === -1) return [...list, probe]
  const next = list.slice()
  next[idx] = probe
  return next
}

function uniqueKey<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of items) {
    const k = key(item)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(item)
  }
  return out
}
