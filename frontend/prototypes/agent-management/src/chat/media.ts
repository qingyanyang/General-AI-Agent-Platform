/**
 * PROTOTYPE multimodal fixtures (#57). Files never leave the browser.
 * Sample analysis is labeled fixture content, not a parse of a chosen file.
 */
export const ATTACHMENT_LIMITS = {
  maxBytes: 8 * 1024 * 1024,
  maxCount: 6,
  extensions: ['png', 'jpeg', 'jpg', 'webp', 'pdf', 'docx', 'xlsx', 'csv'] as const,
}

export type FixtureId = 'invoice' | 'policy' | 'costs'

export type AttachmentKind = 'image' | 'document' | 'spreadsheet' | 'other'

export type AttachmentStatus = 'preparing' | 'ready' | 'failed' | 'unsupported' | 'oversized'

export type MediaAttachment = {
  id: string
  name: string
  extension: string
  kind: AttachmentKind
  typeLabel: string
  size: number
  status: AttachmentStatus
  detail: string
  previewUrl?: string
  /** When false, the preview URL is a shared fixture and must not be revoked. */
  ownsPreview: boolean
  fixtureId?: FixtureId
  retryable: boolean
}

export type ChartPoint = { label: string; value: number }

export type AssistantMedia = {
  chart?: { title: string; points: ChartPoint[] }
  image?: { url: string; alt: string }
  files?: { id: string; name: string; typeLabel: string; size: number; kind: AttachmentKind; blob: Blob }[]
}

export type GeneratedDraft = {
  name: string
  typeLabel: string
  kind: AttachmentKind
  blob: Blob
  note: string
}

const COSTS: ChartPoint[] = [
  { label: 'Labour', value: 1200 },
  { label: 'Materials', value: 860 },
  { label: 'Plant', value: 430 },
]

const SIMULATED_TRANSCRIPT = 'What does the attached sample show, and what needs approval?'

export function simulatedTranscript(): string {
  return SIMULATED_TRANSCRIPT
}

export function describeLimits(): string {
  const megabytes = ATTACHMENT_LIMITS.maxBytes / (1024 * 1024)
  return `PNG, JPEG, WebP, PDF, DOCX, XLSX, and CSV up to ${megabytes} MB. Up to ${ATTACHMENT_LIMITS.maxCount} files. Files stay in this browser and are not uploaded.`
}

export function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} B`
  }
  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)} KB`
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

export function statusLabel(status: AttachmentStatus): string {
  switch (status) {
    case 'preparing':
      return 'Preparing'
    case 'ready':
      return 'Ready'
    case 'failed':
      return 'Preparation failed'
    case 'unsupported':
      return 'Unsupported type'
    case 'oversized':
      return `Over ${formatBytes(ATTACHMENT_LIMITS.maxBytes)}`
    default: {
      const unreachable: never = status
      return unreachable
    }
  }
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
}

function kindFor(extension: string): AttachmentKind {
  switch (extension) {
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'webp':
      return 'image'
    case 'pdf':
    case 'docx':
      return 'document'
    case 'xlsx':
    case 'csv':
      return 'spreadsheet'
    default:
      return 'other'
  }
}

function typeLabel(extension: string): string {
  if (extension === 'jpg' || extension === 'jpeg') {
    return 'JPEG'
  }
  return extension ? extension.toUpperCase() : 'FILE'
}

let sequence = 0

export function nextMediaId(prefix: string): string {
  sequence += 1
  return `${prefix}-${sequence}`
}

function baseAttachment(name: string, size: number, status: AttachmentStatus, detail: string): MediaAttachment {
  const extension = extensionOf(name)
  return {
    id: nextMediaId('file'),
    name,
    extension,
    kind: kindFor(extension),
    typeLabel: typeLabel(extension),
    size,
    status,
    detail,
    ownsPreview: false,
    retryable: false,
  }
}

export function attachmentFromFile(file: File): MediaAttachment {
  const extension = extensionOf(file.name)
  const accepted = (ATTACHMENT_LIMITS.extensions as readonly string[]).includes(extension)
  if (file.size > ATTACHMENT_LIMITS.maxBytes) {
    return {
      ...baseAttachment(file.name, file.size, 'oversized', `Limit is ${formatBytes(ATTACHMENT_LIMITS.maxBytes)}.`),
    }
  }
  if (!accepted) {
    return {
      ...baseAttachment(
        file.name,
        file.size,
        'unsupported',
        'Use PNG, JPEG, WebP, PDF, DOCX, XLSX, or CSV.',
      ),
    }
  }
  if (file.name.toLowerCase().includes('fail')) {
    return {
      ...baseAttachment(file.name, file.size, 'failed', 'Preparation failed. Simulated.'),
      retryable: true,
    }
  }
  const previewUrl = kindFor(extension) === 'image' ? URL.createObjectURL(file) : undefined
  return {
    ...baseAttachment(file.name, file.size, 'ready', 'Ready. This file stays in the browser.'),
    previewUrl,
    ownsPreview: previewUrl !== undefined,
  }
}

export function demonstrationAttachment(kind: 'oversized' | 'failed' | 'unsupported'): MediaAttachment {
  switch (kind) {
    case 'oversized':
      return baseAttachment(
        'site-photo.png',
        ATTACHMENT_LIMITS.maxBytes + 1,
        'oversized',
        `Limit is ${formatBytes(ATTACHMENT_LIMITS.maxBytes)}. Simulated.`,
      )
    case 'unsupported':
      return baseAttachment('walkthrough.mp4', 240_000, 'unsupported', 'Video is out of scope. Simulated.')
    case 'failed':
      return {
        ...baseAttachment('scan.pdf', 120_000, 'failed', 'Preparation failed. Simulated.'),
        retryable: true,
      }
    default: {
      const unreachable: never = kind
      return unreachable
    }
  }
}

export function recoverAttachment(attachment: MediaAttachment): MediaAttachment {
  return {
    ...attachment,
    status: 'ready',
    detail: 'Ready after retry. Simulated. This file stays in the browser.',
    retryable: false,
  }
}

const previewUrls = new Map<FixtureId, string>()

function blobUrl(id: FixtureId, blob: Blob): string {
  const existing = previewUrls.get(id)
  if (existing) {
    return existing
  }
  const url = URL.createObjectURL(blob)
  previewUrls.set(id, url)
  return url
}

function samplePdf(message = 'Sample policy fixture. Not parsed.'): Blob {
  const stream = `BT /F1 18 Tf 72 720 Td (${message}) Tj ET\n`
  const objects = [
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n',
    '2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n',
    `4 0 obj<</Length ${stream.length}>>stream\n${stream}endstream\nendobj\n`,
    '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n',
  ]
  let body = '%PDF-1.4\n'
  const offsets = [0]
  for (const object of objects) {
    offsets.push(body.length)
    body += object
  }
  const xrefAt = body.length
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let index = 1; index < offsets.length; index += 1) {
    xref += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`
  }
  const trailer = `trailer<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefAt}\n%%EOF`
  return new Blob([body + xref + trailer], { type: 'application/pdf' })
}

function sampleCsv(): Blob {
  const lines = ['category,amount', ...COSTS.map((point) => `${point.label},${point.value}`)]
  return new Blob([`${lines.join('\n')}\n`], { type: 'text/csv' })
}

function paint(
  draw: (context: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => void,
  type: 'image/png' | 'image/jpeg' = 'image/png',
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = 640
  canvas.height = 400
  const context = canvas.getContext('2d')
  if (!context) {
    return Promise.resolve(new Blob())
  }
  draw(context, canvas)
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob ?? new Blob()), type, 0.92)
  })
}

async function sampleInvoice(): Promise<Blob> {
  return paint((context) => {
    context.fillStyle = '#f6f6f3'
    context.fillRect(0, 0, 640, 400)
    context.fillStyle = '#ffffff'
    context.fillRect(36, 28, 568, 344)
    context.strokeStyle = '#e3e5e0'
    context.strokeRect(36, 28, 568, 344)
    context.fillStyle = '#1f5a52'
    context.font = 'bold 28px Georgia, serif'
    context.fillText('Sample invoice', 60, 84)
    context.fillStyle = '#1d2522'
    context.font = '16px sans-serif'
    context.fillText('Harbour Fitouts', 60, 130)
    context.fillText('INV-2048', 60, 158)
    context.fillText('March deposit', 60, 186)
    context.font = 'bold 22px sans-serif'
    context.fillText('$4,800.00', 60, 240)
    context.fillStyle = '#5f6965'
    context.font = '14px sans-serif'
    context.fillText('Bundled prototype fixture. Not read from a file you chose.', 60, 320)
  })
}

async function sampleSketch(): Promise<Blob> {
  return paint((context, canvas) => {
    context.fillStyle = '#e8f1ee'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = '#1f5a52'
    context.fillRect(220, 160, 200, 140)
    context.beginPath()
    context.moveTo(200, 160)
    context.lineTo(320, 80)
    context.lineTo(440, 160)
    context.closePath()
    context.fill()
    context.fillStyle = '#f6f6f3'
    context.font = '16px sans-serif'
    context.fillText('Simulated sample image', 230, 340)
  })
}

const fixtureBlobs = new Map<FixtureId, Blob>()

async function fixtureBlob(id: FixtureId): Promise<Blob> {
  const cached = fixtureBlobs.get(id)
  if (cached) {
    return cached
  }
  const blob = id === 'invoice' ? await sampleInvoice() : id === 'policy' ? samplePdf() : sampleCsv()
  fixtureBlobs.set(id, blob)
  return blob
}

const FIXTURE_META: Record<FixtureId, { name: string; detail: string }> = {
  invoice: { name: 'sample-invoice.png', detail: 'Bundled sample invoice. Not parsed from a file you chose.' },
  policy: { name: 'sample-policy.pdf', detail: 'Bundled sample policy PDF. Not parsed.' },
  costs: { name: 'site-costs.csv', detail: 'Bundled sample spreadsheet. Figures are fixture data.' },
}

export function fixturePlaceholder(id: FixtureId): MediaAttachment {
  const meta = FIXTURE_META[id]
  return { ...baseAttachment(meta.name, 0, 'preparing', 'Preparing…'), fixtureId: id }
}

export async function fixtureAttachment(id: FixtureId): Promise<MediaAttachment> {
  const blob = await fixtureBlob(id)
  const meta = FIXTURE_META[id]
  const attachment = baseAttachment(meta.name, blob.size, 'ready', meta.detail)
  return {
    ...attachment,
    fixtureId: id,
    previewUrl: id === 'invoice' ? blobUrl(id, blob) : undefined,
    ownsPreview: false,
  }
}

export function fixtureDownload(id: FixtureId): Promise<{ name: string; blob: Blob }> {
  return fixtureBlob(id).then((blob) => ({ name: FIXTURE_META[id].name, blob }))
}

export const INVOICE_REPLY = `**Simulated** discussion of the bundled sample invoice. These values are fixture labels, not text read from a file.

| Field | Sample value |
| --- | --- |
| Vendor | Harbour Fitouts |
| Invoice | INV-2048 |
| Amount | $4,800.00 |
| Note | Duplicate March deposit |`

const POLICY_REPLY = `**Simulated** summary of the bundled policy PDF. The document was not parsed.

| Section | Sample point |
| --- | --- |
| Meals | $75/day domestic cap |
| Receipts | Required over $25 |
| Equipment | Admin approval over $2,000 |`

const COSTS_REPLY = `**Simulated** analysis of the bundled site-costs spreadsheet. The table and chart use fixture figures, not a calculation on a file you chose.

| Category | Amount |
| --- | ---: |
| Labour | 1200 |
| Materials | 860 |
| Plant | 430 |`

export type SampleFormat = 'pdf' | 'png' | 'jpeg' | 'docx' | 'xlsx' | 'csv'

export type MediaPlan =
  | { kind: 'text' }
  | { kind: 'image' }
  | { kind: 'sample'; format: SampleFormat }
  | { kind: 'fixtures'; fixtures: FixtureId[]; locals: MediaAttachment[] }
  | { kind: 'unavailable'; locals: MediaAttachment[] }

const SAMPLE_FORMATS: readonly SampleFormat[] = ['pdf', 'png', 'jpeg', 'docx', 'xlsx', 'csv']

export function sampleFormat(text: string): SampleFormat | null {
  const match = /\bsample\s+(pdf|png|jpeg|jpg|docx|xlsx|csv)\b/i.exec(text)
  if (!match) {
    return null
  }
  const raw = match[1].toLowerCase()
  const format: SampleFormat = raw === 'jpg' ? 'jpeg' : (raw as SampleFormat)
  return SAMPLE_FORMATS.includes(format) ? format : null
}

export function wantsGeneratedImage(text: string): boolean {
  return /\b(generate|draw|create|request)\b[^.]*\bimage\b|\bimage of\b/i.test(text)
}

/** Matches the mock chat client's scripted tools so those messages keep approval behavior. */
export function usesScriptedTool(text: string): boolean {
  const lower = text.toLowerCase()
  return (
    /\b(multiply|times|product)\b|×/.test(lower) ||
    /\b(add|plus|sum)\b|\+/.test(lower) ||
    /\becho\b/.test(lower)
  )
}

export function mediaPlan(text: string, attachments: MediaAttachment[]): MediaPlan {
  const fixtures = attachments.flatMap((item) => (item.fixtureId ? [item.fixtureId] : []))
  const locals = attachments.filter((item) => !item.fixtureId)
  if (fixtures.length > 0) {
    return { kind: 'fixtures', fixtures, locals }
  }
  if (locals.length > 0) {
    return { kind: 'unavailable', locals }
  }
  const format = sampleFormat(text)
  if (format) {
    return { kind: 'sample', format }
  }
  if (wantsGeneratedImage(text)) {
    return { kind: 'image' }
  }
  return { kind: 'text' }
}

export async function buildMediaReply(plan: Exclude<MediaPlan, { kind: 'text' }>): Promise<{
  content: string
  media: AssistantMedia
  generated: GeneratedDraft[]
}> {
  if (plan.kind === 'unavailable') {
    const lines = plan.locals.map((item) => `- ${item.name} (${item.typeLabel})`)
    return {
      content: `**Analysis unavailable in this prototype.** These files stayed in the browser and were not uploaded or parsed.\n\n${lines.join('\n')}`,
      media: {},
      generated: [],
    }
  }
  if (plan.kind === 'image') {
    const blob = await sampleSketch()
    const url = URL.createObjectURL(blob)
    return {
      content:
        '**Simulated** image. Nothing was generated by a model. The preview is a sample picture drawn in this browser.',
      media: {
        image: { url, alt: 'Simulated sample image of a simple site sketch. Not produced by a model.' },
      },
      generated: [
        {
          name: 'sample-sketch.png',
          typeLabel: 'PNG',
          kind: 'image',
          blob,
          note: 'Simulated image output. Not produced by a model.',
        },
      ],
    }
  }
  if (plan.kind === 'sample') {
    return buildSampleReply(plan.format)
  }
  const sections: string[] = []
  const media: AssistantMedia = {}
  const generated: GeneratedDraft[] = []
  if (plan.fixtures.includes('invoice')) {
    sections.push(INVOICE_REPLY)
  }
  if (plan.fixtures.includes('policy')) {
    sections.push(POLICY_REPLY)
  }
  if (plan.fixtures.includes('costs')) {
    sections.push(COSTS_REPLY)
    media.chart = { title: 'Sample costs', points: COSTS }
    const blob = sampleCsv()
    generated.push({
      name: 'site-costs-summary.csv',
      typeLabel: 'CSV',
      kind: 'spreadsheet',
      blob,
      note: 'Simulated spreadsheet output. Fixture figures, not a computed workbook.',
    })
  }
  if (plan.locals.length > 0) {
    const lines = plan.locals.map((item) => `- ${item.name} (${item.typeLabel})`)
    sections.push(
      `**Analysis unavailable** for the other files. They stayed in the browser and were not parsed.\n\n${lines.join('\n')}`,
    )
  }
  return { content: sections.join('\n\n'), media, generated }
}

const SAMPLE_NOTE = 'Simulated output. Drawn in this browser, not produced by a model.'

async function buildSampleReply(format: SampleFormat): Promise<{
  content: string
  media: AssistantMedia
  generated: GeneratedDraft[]
}> {
  switch (format) {
    case 'pdf':
      return fileReply(
        'sample-note.pdf',
        'PDF',
        'document',
        samplePdf('Simulated sample PDF. Not produced by a model.'),
      )
    case 'png': {
      const blob = await sampleSketch()
      return imageReply('PNG', 'sample-sketch.png', blob, 'Simulated sample PNG of a simple site sketch.')
    }
    case 'jpeg': {
      const blob = await paint((context, canvas) => {
        context.fillStyle = '#d7e6df'
        context.fillRect(0, 0, canvas.width, canvas.height)
        context.fillStyle = '#1f5a52'
        context.beginPath()
        context.arc(320, 170, 90, 0, Math.PI * 2)
        context.fill()
        context.fillStyle = '#1d2522'
        context.font = '16px sans-serif'
        context.fillText('Simulated sample JPEG', 230, 320)
      }, 'image/jpeg')
      return imageReply('JPEG', 'sample-photo.jpeg', blob, 'Simulated sample JPEG. Not produced by a model.')
    }
    case 'docx':
      return fileReply('sample-note.docx', 'DOCX', 'document', sampleDocx())
    case 'xlsx':
      return fileReply('sample-costs.xlsx', 'XLSX', 'spreadsheet', sampleXlsx())
    case 'csv':
      return fileReply('sample-costs.csv', 'CSV', 'spreadsheet', sampleCsv())
    default: {
      const unreachable: never = format
      return unreachable
    }
  }
}

function imageReply(typeLabel: string, name: string, blob: Blob, alt: string): {
  content: string
  media: AssistantMedia
  generated: GeneratedDraft[]
} {
  return {
    content: `**Simulated** ${typeLabel}. Nothing was generated by a model. The preview and file were drawn in this browser.`,
    media: { image: { url: URL.createObjectURL(blob), alt } },
    generated: [{ name, typeLabel, kind: 'image', blob, note: SAMPLE_NOTE }],
  }
}

function fileReply(name: string, typeLabel: string, kind: AttachmentKind, blob: Blob): {
  content: string
  media: AssistantMedia
  generated: GeneratedDraft[]
} {
  return {
    content: `**Simulated** ${typeLabel}. Nothing was generated by a model. Download the sample from the card below. It stays in this browser.`,
    media: {},
    generated: [{ name, typeLabel, kind, blob, note: SAMPLE_NOTE }],
  }
}

function sampleDocx(): Blob {
  return storeZip(
    [
      {
        name: '[Content_Types].xml',
        text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
      },
      {
        name: '_rels/.rels',
        text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
      },
      {
        name: 'word/document.xml',
        text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Simulated sample document. Not produced by a model.</w:t></w:r></w:p><w:p><w:r><w:t>Harbour Fitouts site induction is booked.</w:t></w:r></w:p></w:body></w:document>`,
      },
    ],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  )
}

function sampleXlsx(): Blob {
  return storeZip(
    [
      {
        name: '[Content_Types].xml',
        text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
      },
      {
        name: '_rels/.rels',
        text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      },
      {
        name: 'xl/workbook.xml',
        text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Costs" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      },
      {
        name: 'xl/_rels/workbook.xml.rels',
        text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
      },
      {
        name: 'xl/styles.xml',
        text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`,
      },
      {
        name: 'xl/worksheets/sheet1.xml',
        text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Category</t></is></c><c r="B1" t="inlineStr"><is><t>Amount</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Labour</t></is></c><c r="B2"><v>1200</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>Materials</t></is></c><c r="B3"><v>860</v></c></row><row r="4"><c r="A4" t="inlineStr"><is><t>Plant</t></is></c><c r="B4"><v>430</v></c></row></sheetData></worksheet>`,
      },
    ],
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      const mixed = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
      crc = mixed >>> 0
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function storeZip(entries: { name: string; text: string }[], mime: string): Blob {
  const encoder = new TextEncoder()
  const locals: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const entry of entries) {
    const name = encoder.encode(entry.name)
    const data = encoder.encode(entry.text)
    const checksum = crc32(data)
    const local = new Uint8Array(30 + name.length + data.length)
    const view = new DataView(local.buffer)
    view.setUint32(0, 0x04034b50, true)
    view.setUint16(4, 20, true)
    view.setUint16(8, 0, true)
    view.setUint32(14, checksum, true)
    view.setUint32(18, data.length, true)
    view.setUint32(22, data.length, true)
    view.setUint16(26, name.length, true)
    local.set(name, 30)
    local.set(data, 30 + name.length)
    locals.push(local)
    const directory = new Uint8Array(46 + name.length)
    const directoryView = new DataView(directory.buffer)
    directoryView.setUint32(0, 0x02014b50, true)
    directoryView.setUint16(4, 20, true)
    directoryView.setUint16(6, 20, true)
    directoryView.setUint32(16, checksum, true)
    directoryView.setUint32(20, data.length, true)
    directoryView.setUint32(24, data.length, true)
    directoryView.setUint16(28, name.length, true)
    directoryView.setUint32(42, offset, true)
    directory.set(name, 46)
    central.push(directory)
    offset += local.length
  }
  const directorySize = central.reduce((sum, part) => sum + part.length, 0)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(8, entries.length, true)
  endView.setUint16(10, entries.length, true)
  endView.setUint32(12, directorySize, true)
  endView.setUint32(16, offset, true)
  return new Blob([...locals, ...central, end], { type: mime })
}
