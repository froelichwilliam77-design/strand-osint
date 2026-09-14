import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { NORTHLINE_ORIGIN, serveNorthline } from './northline.ts'
import { runSpider } from './spider.ts'
import { SsrfError, inspectUrlSafety } from './ssrf.ts'
import { DEFAULT_OPTIONS, type SpiderEvent, type SpiderOptions } from './types.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const isProd = process.env.NODE_ENV === 'production'
const PORT = Number(process.env.PORT || (isProd ? 47631 : 47632))

interface Job {
  id: string
  abort: AbortController
  events: SpiderEvent[]
  listeners: Set<(event: SpiderEvent) => void>
  status: 'running' | 'done' | 'stopped' | 'error'
}

const jobs = new Map<string, Job>()

function publish(job: Job, event: SpiderEvent) {
  job.events.push(event)
  if (event.type === 'status') job.status = event.status
  for (const listener of job.listeners) listener(event)
}

function parseOptions(body: unknown): SpiderOptions {
  const raw = (body ?? {}) as Partial<SpiderOptions>
  const target = String(raw.target ?? '').trim()
  if (!target) throw new Error('Target URL is required')
  const parsed = new URL(target)
  const safety = inspectUrlSafety(parsed.href)
  if (!safety.ok) throw new SsrfError(safety.reason)
  return {
    target: parsed.href,
    mode: raw.mode === 'active' ? 'active' : 'semi-passive',
    scope: raw.scope === 'path-prefix' ? 'path-prefix' : 'same-host',
    depth: clamp(Number(raw.depth ?? DEFAULT_OPTIONS.depth), 1, 8),
    maxPages: clamp(Number(raw.maxPages ?? DEFAULT_OPTIONS.maxPages), 1, 250),
    workers: clamp(Number(raw.workers ?? DEFAULT_OPTIONS.workers), 1, 8),
    delayMs: clamp(Number(raw.delayMs ?? DEFAULT_OPTIONS.delayMs), 0, 5000),
    userAgent: String(raw.userAgent || DEFAULT_OPTIONS.userAgent).slice(0, 180),
    respectRobots: raw.respectRobots !== false,
    followSitemaps: raw.followSitemaps !== false,
    wellKnownSeeds: raw.wellKnownSeeds !== false,
    parseJsUrls: raw.parseJsUrls !== false,
  }
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, Math.round(n)))
}

const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '100kb' }))

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, name: 'STRAND', sample: NORTHLINE_ORIGIN })
})

app.post('/api/spider', (req, res) => {
  try {
    const options = parseOptions(req.body)
    const job: Job = {
      id: randomUUID(),
      abort: new AbortController(),
      events: [],
      listeners: new Set(),
      status: 'running',
    }
    jobs.set(job.id, job)
    publish(job, {
      type: 'log',
      log: { ts: new Date().toISOString(), level: 'info', message: `Spider started for ${options.target}` },
    })
    void runSpider(options, (event) => publish(job, event), job.abort.signal)
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        publish(job, { type: 'error', message })
        publish(job, {
          type: 'status',
          status: 'error',
          stats: { probed: 0, forms: 0, scripts: 0, intel: 0, queued: 0, skipped: 0 },
          message,
        })
      })
      .finally(() => {
        setTimeout(() => jobs.delete(job.id), 30 * 60 * 1000)
      })
    res.json({ id: job.id })
  } catch (err) {
    const status = err instanceof SsrfError ? 400 : err instanceof TypeError ? 400 : 400
    res.status(status).json({ error: err instanceof Error ? err.message : 'Invalid request' })
  }
})

app.get('/api/spider/:id/events', (req, res) => {
  const job = jobs.get(String(req.params.id))
  if (!job) {
    res.status(404).json({ error: 'Unknown job' })
    return
  }
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  })
  const send = (event: SpiderEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`)
  }
  for (const event of job.events) send(event)
  job.listeners.add(send)
  const ping = setInterval(() => res.write(': ping\n\n'), 15000)
  req.on('close', () => {
    clearInterval(ping)
    job.listeners.delete(send)
  })
})

app.post('/api/spider/:id/stop', (req, res) => {
  const job = jobs.get(String(req.params.id))
  if (!job) {
    res.status(404).json({ error: 'Unknown job' })
    return
  }
  job.abort.abort()
  res.json({ ok: true })
})

app.get('/api/spider/:id', (req, res) => {
  const job = jobs.get(String(req.params.id))
  if (!job) {
    res.status(404).json({ error: 'Unknown job' })
    return
  }
  res.json({ id: job.id, status: job.status, events: job.events })
})

app.use('/northline', (req, res) => {
  const suffix = req.url || '/'
  const url = new URL(suffix, NORTHLINE_ORIGIN)
  const result = serveNorthline(url)
  for (const [key, value] of Object.entries(result.headers)) {
    res.setHeader(key, value)
  }
  res.status(result.status).end(result.body)
})

async function listen() {
  if (isProd) {
    const dist = path.join(root, 'dist')

    // PWA: explicit types + SW scope at /; avoid SPA fallback swallowing these
    app.get('/sw.js', (_req, res) => {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Service-Worker-Allowed', '/')
      res.sendFile(path.join(dist, 'sw.js'))
    })
    app.get('/manifest.webmanifest', (_req, res) => {
      res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8')
      res.sendFile(path.join(dist, 'manifest.webmanifest'))
    })

    app.use(
      express.static(dist, {
        setHeaders(res, filePath) {
          if (filePath.endsWith('.webmanifest')) {
            res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8')
          }
        },
      }),
    )
    app.get('/{*path}', (_req, res) => {
      res.sendFile(path.join(dist, 'index.html'))
    })
  }
  const server = http.createServer(app)
  const HOST = process.env.HOST || (isProd ? '0.0.0.0' : '127.0.0.1')
  await new Promise<void>((resolve) => server.listen(PORT, HOST, resolve))
  console.log(`STRAND API on http://${HOST}:${PORT}`)
}

if (!process.argv[1] || fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  listen().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}

export { app, parseOptions }
