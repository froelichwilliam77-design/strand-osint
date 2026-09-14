import { useMemo, type ReactNode } from 'react'
import { Download, Radio, X } from 'lucide-react'
import { Button } from '@/components/ui'
import { exportCsv, exportJson } from '@/lib/export'
import type { FormResult, IntelResult, LogEvent, ProbeResult, SeedResult, SpiderStats } from '@/lib/utils'
import { cn } from '@/lib/utils'

const TABS = ['Endpoints', 'Headers', 'Forms', 'Seeds', 'Tree', 'Intel', 'Log'] as const
export type Tab = (typeof TABS)[number]

export function Metrics({ stats, uniqueIntel, uniqueScripts }: { stats: SpiderStats; uniqueIntel: number; uniqueScripts: number }) {
  const items = [
    { label: 'Probed', value: stats.probed, hint: 'URLs' },
    { label: 'Forms', value: stats.forms, hint: 'extracted' },
    { label: 'Scripts', value: uniqueScripts || stats.scripts, hint: 'JS' },
    { label: 'Intel', value: uniqueIntel || stats.intel, hint: 'emails / phones / sites' },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="rounded-2xl border border-line bg-panel px-4 py-3">
          <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">{item.label}</div>
          <div className="mt-1 text-3xl font-semibold tracking-tight">{item.value}</div>
          <div className="text-xs text-muted">{item.hint}</div>
        </div>
      ))}
    </div>
  )
}

export function Results({
  tab,
  onTab,
  statusLabel,
  probes,
  forms,
  seeds,
  intel,
  logs,
  selected,
  onSelect,
}: {
  tab: Tab
  onTab: (tab: Tab) => void
  statusLabel: string
  probes: ProbeResult[]
  forms: FormResult[]
  seeds: SeedResult[]
  intel: IntelResult[]
  logs: LogEvent[]
  selected: ProbeResult | null
  onSelect: (probe: ProbeResult | null) => void
}) {
  const canExport = probes.length + forms.length + intel.length + seeds.length > 0
  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-2xl border border-line bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="text-sm text-muted">{statusLabel}</div>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            className="h-8 px-2 text-xs"
            disabled={!canExport}
            onClick={() => exportCsv(probes, forms, intel, seeds)}
          >
            <Download className="h-3.5 w-3.5" />
            CSV
          </Button>
          <Button
            variant="ghost"
            className="h-8 px-2 text-xs"
            disabled={!canExport}
            onClick={() =>
              exportJson({
                generatedAt: new Date().toISOString(),
                probes,
                forms,
                seeds,
                intel,
                logs,
              })
            }
          >
            <Download className="h-3.5 w-3.5" />
            JSON
          </Button>
        </div>
      </div>
      <div className="border-b border-line px-3 py-2">
        <div className="flex gap-1 overflow-x-auto rounded-xl bg-[#0e100e] p-1">
          {TABS.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => onTab(name)}
              className={cn(
                'shrink-0 rounded-lg px-3 py-1.5 text-sm text-muted transition',
                tab === name && 'tab-active',
              )}
            >
              {name}
            </button>
          ))}
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0 overflow-auto scrollbar-thin">
          {tab === 'Endpoints' && <EndpointsTable probes={probes} selected={selected} onSelect={onSelect} />}
          {tab === 'Headers' && <HeadersTable probes={probes.filter((p) => !p.skipped)} selected={selected} onSelect={onSelect} />}
          {tab === 'Forms' && <FormsList forms={forms} />}
          {tab === 'Seeds' && <SeedsList seeds={seeds} />}
          {tab === 'Tree' && <UrlTree probes={probes} onSelect={onSelect} />}
          {tab === 'Intel' && <IntelList intel={intel} />}
          {tab === 'Log' && <LogList logs={logs} />}
        </div>
        {selected && (tab === 'Endpoints' || tab === 'Headers' || tab === 'Tree') && (
          <HeaderInspector probe={selected} onClose={() => onSelect(null)} />
        )}
      </div>
    </section>
  )
}

function Empty({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex h-full min-h-64 flex-col items-center justify-center gap-3 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-dashed border-line text-muted">
        <Radio className="h-5 w-5" />
      </div>
      <div>
        <div className="text-sm text-fog">{title}</div>
        <div className="mt-1 text-xs text-muted">{hint}</div>
      </div>
    </div>
  )
}

function EndpointsTable({
  probes,
  selected,
  onSelect,
}: {
  probes: ProbeResult[]
  selected: ProbeResult | null
  onSelect: (probe: ProbeResult) => void
}) {
  if (!probes.length) return <Empty title="No endpoints yet" hint="Run the spider against an authorized target or the Northline sample." />
  return (
    <table className="w-full min-w-[640px] text-left text-sm">
      <thead className="sticky top-0 bg-panel text-[11px] uppercase tracking-[0.12em] text-muted">
        <tr>
          <th className="px-4 py-2 font-medium">Status</th>
          <th className="px-2 py-2 font-medium">Method</th>
          <th className="px-2 py-2 font-medium">URL</th>
          <th className="px-2 py-2 font-medium">Type</th>
          <th className="px-4 py-2 font-medium">Source</th>
        </tr>
      </thead>
      <tbody>
        {probes.map((probe) => (
          <tr
            key={`${probe.url}:${probe.source}`}
            className={cn(
              'cursor-pointer border-t border-line/70 hover:bg-raised',
              selected?.url === probe.url && 'bg-raised',
            )}
            onClick={() => onSelect(probe)}
          >
            <td className="px-4 py-2 font-mono text-xs">
              {probe.skipped ? <span className="text-warn">skip</span> : statusTone(probe.status)}
            </td>
            <td className="px-2 py-2 font-mono text-xs text-muted">{probe.method}</td>
            <td className="max-w-[420px] truncate px-2 py-2 font-mono text-xs" title={probe.url}>
              {probe.url}
            </td>
            <td className="px-2 py-2 text-xs text-muted">{probe.mime || probe.skipped || '—'}</td>
            <td className="px-4 py-2 text-xs text-muted">{probe.source}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function HeadersTable({
  probes,
  selected,
  onSelect,
}: {
  probes: ProbeResult[]
  selected: ProbeResult | null
  onSelect: (probe: ProbeResult) => void
}) {
  if (!probes.length) return <Empty title="No headers yet" hint="Probed responses will show HSTS, CSP, XFO, cookies, and banners here." />
  return (
    <table className="w-full min-w-[720px] text-left text-sm">
      <thead className="sticky top-0 bg-panel text-[11px] uppercase tracking-[0.12em] text-muted">
        <tr>
          <th className="px-4 py-2 font-medium">URL</th>
          <th className="px-2 py-2 font-medium">Server</th>
          <th className="px-2 py-2 font-medium">HSTS</th>
          <th className="px-2 py-2 font-medium">CSP</th>
          <th className="px-2 py-2 font-medium">XFO</th>
          <th className="px-4 py-2 font-medium">Cookies</th>
        </tr>
      </thead>
      <tbody>
        {probes.map((probe) => (
          <tr
            key={probe.url}
            className={cn('cursor-pointer border-t border-line/70 hover:bg-raised', selected?.url === probe.url && 'bg-raised')}
            onClick={() => onSelect(probe)}
          >
            <td className="max-w-[280px] truncate px-4 py-2 font-mono text-xs">{probe.url}</td>
            <td className="px-2 py-2 text-xs">{probe.server || '—'}</td>
            <td className="px-2 py-2 text-xs">{flag(probe.securityHeaders.hsts)}</td>
            <td className="px-2 py-2 text-xs">{flag(probe.securityHeaders.csp)}</td>
            <td className="px-2 py-2 text-xs">{flag(probe.securityHeaders.xfo)}</td>
            <td className="px-4 py-2 font-mono text-xs text-muted">{probe.cookies.join(', ') || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function FormsList({ forms }: { forms: FormResult[] }) {
  if (!forms.length) return <Empty title="No forms extracted" hint="HTML forms, including hidden CSRF fields, appear after a crawl." />
  return (
    <div className="space-y-3 p-4">
      {forms.map((form, i) => (
        <article key={`${form.page}:${form.action}:${i}`} className="rounded-xl border border-line bg-raised p-3">
          <div className="text-xs text-muted">{form.page}</div>
          <div className="mt-1 font-mono text-sm">
            <span className="text-sage-dim">{form.method}</span> {form.action}
          </div>
          <ul className="mt-2 space-y-1 text-xs">
            {form.fields.map((field) => (
              <li key={field.name} className="flex gap-2 font-mono">
                <span className="text-muted">{field.type}</span>
                <span>{field.name}</span>
                {field.value ? <span className="truncate text-sage-dim">{field.value}</span> : null}
              </li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  )
}

function SeedsList({ seeds }: { seeds: SeedResult[] }) {
  if (!seeds.length) return <Empty title="No seeds" hint="robots.txt, sitemaps, manifests, and well-known files show up here." />
  const unique = uniqueBy(seeds, (s) => `${s.kind}:${s.url}`)
  return (
    <ul className="divide-y divide-line">
      {unique.map((seed) => (
        <li key={`${seed.kind}:${seed.url}`} className="px-4 py-2.5">
          <div className="text-[11px] uppercase tracking-[0.12em] text-sage-dim">{seed.kind}</div>
          <div className="font-mono text-xs">{seed.url}</div>
          <div className="text-xs text-muted">{seed.detail}</div>
        </li>
      ))}
    </ul>
  )
}

function IntelList({ intel }: { intel: IntelResult[] }) {
  if (!intel.length) {
    return (
      <Empty
        title="No intel yet"
        hint="Emails, phones, domains, and site candidates from crawls or email OSINT appear here."
      />
    )
  }
  return (
    <ul className="divide-y divide-line">
      {intel.map((item) => (
        <li key={`${item.type}:${item.value}`} className="flex items-baseline justify-between gap-3 px-4 py-2.5">
          <div>
            <div className="text-[11px] uppercase tracking-[0.12em] text-sage-dim">{item.type}</div>
            <div className="font-mono text-sm">{item.value}</div>
          </div>
          <div className="truncate text-xs text-muted" title={item.source}>
            {item.source}
          </div>
        </li>
      ))}
    </ul>
  )
}

function LogList({ logs }: { logs: LogEvent[] }) {
  if (!logs.length) return <Empty title="Log is quiet" hint="Crawl events, robots skips, and fetch errors stream here." />
  return (
    <ol className="space-y-1 p-3 font-mono text-xs">
      {logs.map((log, i) => (
        <li key={`${log.ts}:${i}`} className="flex gap-2">
          <span className="text-muted">{log.ts.slice(11, 19)}</span>
          <span
            className={cn(
              log.level === 'error' && 'text-danger',
              log.level === 'warn' && 'text-warn',
              log.level === 'skip' && 'text-warn',
              log.level === 'info' && 'text-fog',
            )}
          >
            {log.message}
          </span>
        </li>
      ))}
    </ol>
  )
}

function UrlTree({ probes, onSelect }: { probes: ProbeResult[]; onSelect: (probe: ProbeResult) => void }) {
  const tree = useMemo(() => buildTree(probes), [probes])
  if (!probes.length) return <Empty title="No tree yet" hint="Discovered paths will nest under the target host." />
  return <div className="p-3 font-mono text-xs">{tree.map((node) => <TreeNodeView key={node.path} node={node} onSelect={onSelect} depth={0} />)}</div>
}

interface TreeNode {
  name: string
  path: string
  probe?: ProbeResult
  children: TreeNode[]
}

function buildTree(probes: ProbeResult[]): TreeNode[] {
  const roots = new Map<string, TreeNode>()
  for (const probe of probes) {
    let url: URL
    try {
      url = new URL(probe.url)
    } catch {
      continue
    }
    let root = roots.get(url.host)
    if (!root) {
      root = { name: url.host, path: url.origin, children: [] }
      roots.set(url.host, root)
    }
    const parts = url.pathname.split('/').filter(Boolean)
    let cursor = root
    let acc = ''
    for (const part of parts) {
      acc += `/${part}`
      let child = cursor.children.find((c) => c.name === part)
      if (!child) {
        child = { name: part, path: `${url.origin}${acc}`, children: [] }
        cursor.children.push(child)
      }
      cursor = child
    }
    cursor.probe = probe
  }
  return [...roots.values()]
}

function TreeNodeView({ node, onSelect, depth }: { node: TreeNode; onSelect: (probe: ProbeResult) => void; depth: number }) {
  return (
    <div>
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-raised"
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => node.probe && onSelect(node.probe)}
      >
        <span className="text-fog">{node.name}</span>
        {node.probe?.skipped ? <span className="text-warn">skip</span> : null}
        {node.probe && !node.probe.skipped ? <span className="text-muted">{node.probe.status}</span> : null}
      </button>
      {node.children.map((child) => (
        <TreeNodeView key={child.path} node={child} onSelect={onSelect} depth={depth + 1} />
      ))}
    </div>
  )
}

function HeaderInspector({ probe, onClose }: { probe: ProbeResult; onClose: () => void }) {
  return (
    <aside className="absolute inset-y-0 right-0 z-10 flex w-full max-w-md flex-col border-l border-line bg-[#101310] shadow-2xl">
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.14em] text-muted">Header inspector</div>
          <div className="mt-1 break-all font-mono text-xs">{probe.url}</div>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg p-1 text-muted hover:bg-raised hover:text-ink-2">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto scrollbar-thin p-4 text-sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted">Status</dt>
          <dd>{probe.skipped ? `skipped (${probe.skipped})` : probe.status}</dd>
          <dt className="text-muted">Method</dt>
          <dd>{probe.method}</dd>
          <dt className="text-muted">Type</dt>
          <dd>{probe.contentType || '—'}</dd>
          <dt className="text-muted">Server</dt>
          <dd>{probe.server || '—'}</dd>
          <dt className="text-muted">Size</dt>
          <dd>{probe.size} B</dd>
        </dl>
        {probe.redirectChain.length > 0 && (
          <div className="mt-4">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted">Redirect chain</div>
            <ol className="mt-1 space-y-1 font-mono text-xs">
              {probe.redirectChain.map((hop) => (
                <li key={hop}>{hop}</li>
              ))}
            </ol>
          </div>
        )}
        <div className="mt-4">
          <div className="text-[11px] uppercase tracking-[0.14em] text-muted">Security headers</div>
          <ul className="mt-2 space-y-1 text-xs">
            {Object.entries({
              HSTS: probe.securityHeaders.hsts,
              CSP: probe.securityHeaders.csp,
              'X-Frame-Options': probe.securityHeaders.xfo,
              'X-Content-Type-Options': probe.securityHeaders.xcto,
              'Referrer-Policy': probe.securityHeaders.referrerPolicy,
              'Permissions-Policy': probe.securityHeaders.permissionsPolicy,
              'X-XSS-Protection': probe.securityHeaders.xxss,
            }).map(([name, value]) => (
              <li key={name}>
                <span className="text-muted">{name}:</span> {value || <span className="text-danger">missing</span>}
              </li>
            ))}
          </ul>
        </div>
        {probe.cookies.length > 0 && (
          <div className="mt-4">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted">Cookies</div>
            <ul className="mt-1 font-mono text-xs">
              {probe.cookies.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-4">
          <div className="text-[11px] uppercase tracking-[0.14em] text-muted">All headers</div>
          <pre className="mt-2 whitespace-pre-wrap break-all font-mono text-[11px] text-fog">
            {Object.keys(probe.headers).length
              ? Object.entries(probe.headers)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join('\n')
              : 'No headers (skipped or virtual skip).'}
          </pre>
        </div>
      </div>
    </aside>
  )
}

function statusTone(status: number): ReactNode {
  const cls = status >= 200 && status < 300 ? 'text-sage-dim' : status >= 300 && status < 400 ? 'text-warn' : 'text-danger'
  return <span className={cls}>{status}</span>
}

function flag(value: string | null) {
  return value ? <span className="text-sage-dim">yes</span> : <span className="text-danger">no</span>
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
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
