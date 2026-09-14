import { FlaskConical, Play, Square } from 'lucide-react'
import { Button, Field, Input, NativeSelect, SliderRow, Toggle } from '@/components/ui'
import { NORTHLINE_TARGET, peekSeedKind, type SeedKind, type SpiderOptions } from '@/lib/utils'

const KIND_HINT: Record<SeedKind, string> = {
  url: 'URL crawl',
  email: 'Email OSINT',
  username: 'Username probes',
  phone: 'Phone parse',
  unknown: 'Unrecognized',
}

export function ControlPanel({
  options,
  running,
  onChange,
  onRun,
  onStop,
}: {
  options: SpiderOptions
  running: boolean
  onChange: (next: SpiderOptions) => void
  onRun: () => void
  onStop: () => void
}) {
  const set = <K extends keyof SpiderOptions>(key: K, value: SpiderOptions[K]) => onChange({ ...options, [key]: value })
  const kind = peekSeedKind(options.target)
  const crawlOpen = kind === 'url' || kind === 'unknown'
  const action = actionLabel(kind, running)

  return (
    <aside className="flex min-h-0 flex-col rounded-2xl border border-line bg-panel p-4 lg:h-full">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto scrollbar-thin pr-1">
        <Field label="Target" hint={options.target.trim() ? KIND_HINT[kind] : undefined}>
          <Input
            value={options.target}
            placeholder="URL, email, @username, or phone"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            inputMode="url"
            onChange={(e) => set('target', e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !running) onRun()
            }}
          />
        </Field>
        <p className="text-xs leading-5 text-muted">
          {kind === 'email' && 'Public records only: MX, Gravatar, holehe-style site checks. Never emails the mailbox.'}
          {kind === 'username' && 'Probes public profile URLs. Hits are confirmed pages, not guesses.'}
          {kind === 'phone' && 'Normalizes E.164 and numbering-plan metadata. No CNAM, SMS, or live carrier dips.'}
          {kind === 'url' && 'Authorized crawl: seeds, DOM extraction, headers. Private/loopback targets are blocked.'}
          {kind === 'unknown' && 'Paste https://…, name@domain, @handle, or +1…'}
        </p>
        <Button type="button" variant="outline" className="w-full" onClick={() => set('target', NORTHLINE_TARGET)}>
          <FlaskConical className="h-4 w-4" />
          Load Northline sample
        </Button>
        <details className="rounded-xl border border-line" open={crawlOpen}>
          <summary className="cursor-pointer list-none px-3 py-3 text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
            Crawl options
            <span className="ml-2 font-sans normal-case tracking-normal text-[11px] text-fog">
              {crawlOpen ? 'used for URL targets' : 'optional for this seed'}
            </span>
          </summary>
          <div className="space-y-4 border-t border-line px-3 py-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Mode">
                <NativeSelect value={options.mode} onChange={(e) => set('mode', e.target.value as SpiderOptions['mode'])}>
                  <option value="semi-passive">Semi-passive</option>
                  <option value="active">Active</option>
                </NativeSelect>
              </Field>
              <Field label="Scope">
                <NativeSelect value={options.scope} onChange={(e) => set('scope', e.target.value as SpiderOptions['scope'])}>
                  <option value="same-host">Same host</option>
                  <option value="path-prefix">Path prefix</option>
                </NativeSelect>
              </Field>
            </div>
            <SliderRow label="Depth" value={options.depth} min={1} max={6} onChange={(v) => set('depth', v)} />
            <SliderRow label="Max pages" value={options.maxPages} min={10} max={200} step={5} onChange={(v) => set('maxPages', v)} />
            <SliderRow label="Workers" value={options.workers} min={1} max={8} onChange={(v) => set('workers', v)} />
            <SliderRow label="Delay" value={options.delayMs} min={0} max={2000} step={50} suffix="ms" onChange={(v) => set('delayMs', v)} />
            <Field label="User-Agent">
              <Input value={options.userAgent} onChange={(e) => set('userAgent', e.target.value)} />
            </Field>
            <div className="divide-y divide-line rounded-xl border border-line px-3">
              <Toggle label="Respect robots.txt" checked={options.respectRobots} onChange={(v) => set('respectRobots', v)} />
              <Toggle label="Follow sitemaps" checked={options.followSitemaps} onChange={(v) => set('followSitemaps', v)} />
              <Toggle label="Well-known seeds" checked={options.wellKnownSeeds} onChange={(v) => set('wellKnownSeeds', v)} />
              <Toggle label="Parse JavaScript URLs" checked={options.parseJsUrls} onChange={(v) => set('parseJsUrls', v)} />
            </div>
          </div>
        </details>
        <p className="text-[11px] leading-5 text-muted">
          Only use STRAND against systems and identifiers you are authorized to investigate. Server-side probes block
          private, loopback, link-local, and metadata addresses. Jobs never send SMTP, SMS, or phishing.
        </p>
      </div>
      <div className="strand-run mt-4 sticky bottom-0 bg-panel pt-2">
        {running ? (
          <Button type="button" variant="danger" className="w-full py-3 text-base" onClick={onStop}>
            <Square className="h-3.5 w-3.5 fill-current" />
            {action}
          </Button>
        ) : (
          <Button type="button" className="w-full py-3 text-base font-semibold" onClick={onRun}>
            <Play className="h-4 w-4 fill-current" />
            {action}
          </Button>
        )}
      </div>
    </aside>
  )
}

function actionLabel(kind: SeedKind, running: boolean): string {
  if (running) {
    if (kind === 'email') return 'Stop email intel'
    if (kind === 'username') return 'Stop username intel'
    if (kind === 'phone') return 'Stop phone intel'
    return 'Stop spider'
  }
  if (kind === 'email') return 'Run email intel'
  if (kind === 'username') return 'Run username intel'
  if (kind === 'phone') return 'Run phone intel'
  return 'Run spider'
}
