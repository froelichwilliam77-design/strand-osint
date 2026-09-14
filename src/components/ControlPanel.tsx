import { FlaskConical, Play, Square } from 'lucide-react'
import { Button, Field, Input, NativeSelect, SliderRow, Toggle } from '@/components/ui'
import { NORTHLINE_TARGET, isEmailSeed, type SpiderOptions } from '@/lib/utils'

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

  return (
    <aside className="flex min-h-0 flex-col rounded-2xl border border-line bg-panel p-4 lg:h-full">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto scrollbar-thin pr-1">
        <Field label="Target URL or email">
          <Input
            value={options.target}
            placeholder="https://example.com or name@domain.com"
            onChange={(e) => set('target', e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !running) onRun()
            }}
          />
        </Field>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => set('target', NORTHLINE_TARGET)}
        >
          <FlaskConical className="h-4 w-4" />
          Load Northline sample
        </Button>
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
        <p className="text-[11px] leading-5 text-muted">
          Only crawl systems you are authorized to test. Email seeds use public records (Gravatar, DNS, profile URL
          patterns) and never contact the mailbox. Server-side probes block private, loopback, link-local, and metadata
          addresses. Semi-passive mode HEADs binaries and never submits forms.
        </p>
      </div>
      <div className="mt-4">
        {running ? (
          <Button type="button" variant="danger" className="w-full py-2.5" onClick={onStop}>
            <Square className="h-3.5 w-3.5 fill-current" />
            {isEmailSeed(options.target) ? 'Stop' : 'Stop spider'}
          </Button>
        ) : (
          <Button type="button" className="w-full py-2.5 font-semibold" onClick={onRun}>
            <Play className="h-4 w-4 fill-current" />
            {isEmailSeed(options.target) ? 'Run email intel' : 'Run spider'}
          </Button>
        )}
      </div>
    </aside>
  )
}
