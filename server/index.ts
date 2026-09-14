import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { runEmailInvestigation } from './email.ts'
import { isAbortError } from './http.ts'
import { NORTHLINE_ORIGIN, serveNorthline } from './northline.ts'
import { parseOptions } from './options.ts'
import { runPhoneInvestigation } from './phone.ts'
import { classifySeed } from './seed.ts'
import { runSpider } from './spider.ts'
import { SsrfError } from './ssrf.ts'
import type { SpiderEvent, SpiderOptions } from './types.ts'
import { runUsernameInvestigation } from './username.ts'

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
    const kind = classifySeed(options.target).kind
    publish(job, {
      type: 'log',
      log: {
        ts: new Date().toISOString(),
        level: 'info',
        message: startMessage(kind, options.target),
      },
    })
    const runner = pickRunner(kind)
    void runner(options, (event) => publish(job, event), job.abort.signal)
      .catch((err: unknown) => {
        if (job.abort.signal.aborted || isAbortError(err)) {
          if (job.status === 'running') {
            publish(job, {
              type: 'status',
              status: 'stopped',
              stats: { probed: 0, forms: 0, scripts: 0, intel: 0, queued: 0, skipped: 0 },
              message: 'Stopped',
            })
          }
          return
        }
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
    'x-accel-buffering': 'no',
  })
  const send = (event: SpiderEvent) => {
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`)
    } catch {
      job.listeners.delete(send)
    }
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

function startMessage(kind: string, target: string): string {
  if (kind === 'email') return `Email investigation started for ${target}`
  if (kind === 'username') return `Username investigation started for ${target}`
  if (kind === 'phone') return `Phone investigation started for ${target}`
  return `Spider started for ${target}`
}

function pickRunner(kind: string): (
  options: SpiderOptions,
  emit: (event: SpiderEvent) => void,
  signal: AbortSignal,
) => Promise<void> {
  if (kind === 'email') return runEmailInvestigation
  if (kind === 'username') return runUsernameInvestigation
  if (kind === 'phone') return runPhoneInvestigation
  return runSpider
}

export { app, parseOptions }
