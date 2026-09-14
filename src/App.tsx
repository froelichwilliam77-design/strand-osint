import { useMemo, useRef, useState } from 'react'
import { ControlPanel } from '@/components/ControlPanel'
import { Metrics, Results, type Tab } from '@/components/Workspace'
import {
  defaultOptions,
  isEmailSeed,
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

  const uniqueIntel = useMemo(() => uniqueKey(intel, (i) => `${i.type}:${i.value.toLowerCase()}`), [intel])
  const uniqueScripts = useMemo(() => [...new Set(scripts)], [scripts])
  const uniqueSeeds = useMemo(() => uniqueKey(seeds, (s) => `${s.kind}:${s.url}`), [seeds])

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
  }

  const stop = async () => {
    sourceRef.current?.close()
    sourceRef.current = null
    if (jobRef.current) {
      await fetch(`/api/spider/${jobRef.current}/stop`, { method: 'POST' }).catch(() => undefined)
    }
    setRunning(false)
  }

  const run = async () => {
    await stop()
    reset()
    setRunning(true)
    setStatusLabel(isEmailSeed(options.target) ? 'Starting email OSINT…' : 'Starting…')
    if (isEmailSeed(options.target)) setTab('Intel')
    try {
      const res = await fetch('/api/spider', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(options),
      })
      const body = (await res.json()) as { id?: string; error?: string }
      if (!res.ok || !body.id) {
        throw new Error(body.error || 'Could not start spider')
      }
      jobRef.current = body.id
      const source = new EventSource(`/api/spider/${body.id}/events`)
      sourceRef.current = source
      source.onmessage = (message) => {
        const event = JSON.parse(message.data) as SpiderEvent
        applyEvent(event)
      }
      source.onerror = () => {
        source.close()
        setRunning(false)
      }
    } catch (err) {
      setRunning(false)
      setError(err instanceof Error ? err.message : String(err))
      setStatusLabel('Blocked')
    }
  }

  const applyEvent = (event: SpiderEvent) => {
    if (event.type === 'probe') {
      setProbes((prev) => upsertProbe(prev, event.probe))
    } else if (event.type === 'form') {
      setForms((prev) => [...prev, event.form])
    } else if (event.type === 'seed') {
      setSeeds((prev) => [...prev, event.seed])
    } else if (event.type === 'intel') {
      setIntel((prev) => [...prev, event.intel])
    } else if (event.type === 'script') {
      setScripts((prev) => [...prev, event.url])
    } else if (event.type === 'log') {
      setLogs((prev) => [...prev, event.log])
    } else if (event.type === 'status') {
      setStats(event.stats)
      if (event.status === 'running') setStatusLabel(event.message || `Probing (${event.stats.probed})`)
      if (event.status === 'done') {
        setStatusLabel(event.message || `Complete — ${event.stats.probed} URLs`)
        setRunning(false)
        sourceRef.current?.close()
      }
      if (event.status === 'stopped') {
        setStatusLabel('Stopped')
        setRunning(false)
      }
      if (event.status === 'error') {
        setStatusLabel('Error')
        setError(event.message ?? 'Crawl failed')
        setRunning(false)
      }
    } else if (event.type === 'error') {
      setError(event.message)
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
            Active and semi-passive recon: seed discovery, DOM link extraction, MIME and header inspection. Paste an email for public-records OSINT instead of a crawl.
          </p>
        </div>
      </header>
      {error ? (
        <div className="mb-4 rounded-xl border border-[#5a3030] bg-[#241616] px-3 py-2 text-sm text-[#f0c7c7]">{error}</div>
      ) : null}
      <div className="strand-shell flex flex-col gap-4 lg:h-[calc(100svh-9.5rem)] lg:flex-row">
        <div className="strand-sidebar w-full shrink-0 lg:h-full lg:w-[320px]">
          <ControlPanel options={options} running={running} onChange={setOptions} onRun={run} onStop={stop} />
        </div>
        <div className="strand-results flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          <Metrics stats={stats} uniqueIntel={uniqueIntel.length} uniqueScripts={uniqueScripts.length} />
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
