import type { FormResult, IntelResult, ProbeResult, SeedResult } from './utils'

export function downloadBlob(filename: string, mime: string, contents: string) {
  const blob = new Blob([contents], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function exportJson(payload: unknown) {
  downloadBlob('strand-results.json', 'application/json', JSON.stringify(payload, null, 2))
}

export function exportCsv(probes: ProbeResult[], forms: FormResult[], intel: IntelResult[], seeds: SeedResult[]) {
  const lines = [
    'type,url,status,method,mime,source,detail',
    ...probes.map((p) =>
      csv(['probe', p.url, p.status || p.skipped || '', p.method, p.mime, p.source, p.skipped ?? '']),
    ),
    ...forms.map((f) => csv(['form', f.action, f.method, '', '', f.page, f.fields.map((x) => x.name).join(';')])),
    ...intel.map((i) =>
      csv(['intel', i.url || i.value, i.type, i.confidence ?? '', i.site ?? '', i.source, i.evidence ?? i.exists ?? '']),
    ),
    ...seeds.map((s) => csv(['seed', s.url, s.kind, '', '', s.detail, ''])),
  ]
  downloadBlob('strand-results.csv', 'text/csv', lines.join('\n'))
}

function csv(cols: Array<string | number>) {
  return cols
    .map((c) => {
      const s = String(c)
      return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
    })
    .join(',')
}
