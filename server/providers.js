const JSON_HEADERS = { 'content-type': 'application/json' }

function providerKey(provider, request) {
  const value = typeof request.headers?.get === 'function'
    ? request.headers.get('x-provider-api-key')
    : request.headers?.['x-provider-api-key']
  if (!value || typeof value !== 'string') throw new Error('Missing x-provider-api-key header')
  return value
}

async function parseJson(response) {
  const text = await response.text()
  let body
  try { body = text ? JSON.parse(text) : {} } catch { body = { error: text } }
  if (!response.ok) {
    const message = body?.error?.message || body?.error || `Provider request failed (${response.status})`
    throw new Error(message)
  }
  return body
}

const BULK_RATES = {
  openai: { 'gpt-image-1': 0.04, 'dall-e-3': 0.08 },
  gemini: { 'imagen-3': 0.05, 'gemini-2.0-flash-exp': 0.02 },
}

function withBulkRate(provider, model) {
  return { ...model, pricePerImage: model.pricePerImage ?? BULK_RATES[provider]?.[model.id] ?? null }
}

function normalizeOpenAIModels(body) {
  const models = Array.isArray(body.data) ? body.data : []
  return models
    .filter((model) => /image|dall|gpt-image/i.test(model.id))
    .map((model) => withBulkRate('openai', { id: model.id, name: model.id, detail: 'OpenAI image model' }))
}

function normalizeGeminiModels(body) {
  const models = Array.isArray(body.models) ? body.models : []
  return models
    .filter((model) => (model.supportedGenerationMethods || []).some((method) => /generateContent|predict/i.test(method)) && /image|imagen|gemini/i.test(model.name || ''))
    .map((model) => ({
      id: (model.name || '').replace(/^models\//, ''),
      name: model.displayName || model.name,
      detail: 'Google image-capable model',
      pricePerImage: BULK_RATES.gemini[(model.name || '').replace(/^models\//, '')] ?? null,
    }))
}

export async function listModels(provider, request) {
  const key = providerKey(provider, request)
  if (provider === 'openai') {
    const response = await fetch('https://api.openai.com/v1/models', { headers: { authorization: `Bearer ${key}` } })
    return normalizeOpenAIModels(await parseJson(response))
  }
  if (provider === 'gemini') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`
    return normalizeGeminiModels(await parseJson(await fetch(url)))
  }
  throw new Error(`Unsupported provider: ${provider}`)
}

function base64ToBlob(base64, mimeType) {
  const bytes = Buffer.from(base64, 'base64')
  return new Blob([bytes], { type: mimeType })
}

function closestOpenAIEditSize(width, height) {
  const ratio = Number(width) > 0 && Number(height) > 0 ? Number(width) / Number(height) : 1
  const sizes = [
    { value: '1024x1536', ratio: 2 / 3 },
    { value: '1536x1024', ratio: 3 / 2 },
    { value: '1024x1024', ratio: 1 },
  ]
  return sizes.reduce((closest, candidate) => Math.abs(candidate.ratio - ratio) < Math.abs(closest.ratio - ratio) ? candidate : closest).value
}

async function createOpenAIImage({ key, model, prompt, count, quality, references, cards }) {
  const inputs = references?.length ? [references[0]] : [null]
  const jobs = cards?.length ? cards : Array.from({ length: count }, (_, index) => ({ index, name: `Variation ${index + 1}`, description: '' }))
  const images = []
  for (let jobIndex = 0; jobIndex < jobs.length; jobIndex += 1) {
    const job = jobs[jobIndex]
    const reference = inputs[0]
    const form = new FormData()
    form.append('model', model)
    form.append('prompt', `${prompt}\n\nCreate exactly one individual card. Card ${job.number || jobIndex + 1}: ${job.name}.\nUnique card concept: ${job.description || 'Create a distinct variation while preserving the reference style.'}\nDo not create a collage or multiple cards.`)
    form.append('n', '1')
    form.append('size', reference ? closestOpenAIEditSize(reference.width, reference.height) : '1024x1024')

    if (['low', 'medium', 'high'].includes(quality)) form.append('quality', quality)
    if (reference) {
      form.append('image', base64ToBlob(reference.base64, reference.mimeType), `reference-${jobIndex + 1}`)
      form.append('user', `batchroom-card-${jobIndex + 1}`)
    }
    const endpoint = reference ? 'https://api.openai.com/v1/images/edits' : 'https://api.openai.com/v1/images/generations'
    const response = await fetch(endpoint, { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form })
    const result = await parseJson(response)
    images.push(...(result.data || []).map((item) => ({ cardIndex: job.index, cardNumber: job.number, cardName: job.name, source: reference ? 'reference-image-edit' : 'prompt-generation', mimeType: 'image/png', base64: item.b64_json || null, url: item.url || null })))
  }
  return images
}

async function createGeminiImage({ key, model, prompt, count, quality, references, cards }) {
  const reference = references?.[0] || null
  const jobs = cards?.length ? cards : Array.from({ length: count }, (_, index) => ({ index, name: `Variation ${index + 1}`, description: '' }))
  const results = []
  for (const job of jobs) {
      const parts = [{ text: `${prompt}\nCreate exactly one individual card. Card ${job.number || job.index + 1}: ${job.name}. Unique card concept: ${job.description || 'Create a distinct variation while preserving the reference style.'}. Do not create a collage or multiple cards.` }]
      if (reference) parts.push({ inlineData: { mimeType: reference.mimeType, data: reference.base64 } })
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`
      const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'], ...(quality ? { imageConfig: { imageSize: quality } } : {}) } }) })
      const result = await parseJson(response)
      const candidateParts = result.candidates?.[0]?.content?.parts || []
      const imagePart = candidateParts.find((part) => part.inlineData?.data)
      if (imagePart) results.push({ cardIndex: job.index, cardNumber: job.number, cardName: job.name, mimeType: imagePart.inlineData.mimeType || 'image/png', base64: imagePart.inlineData.data })
  }
  return results
}

export async function downloadJobResults(provider, jobId, request) {
  const key = providerKey(provider, request)
  if (provider !== 'openai') throw new Error('Retrieving completed jobs is currently supported for OpenAI batches only.')
  const jobResponse = await fetch(`https://api.openai.com/v1/batches/${encodeURIComponent(jobId)}`, { headers: { authorization: `Bearer ${key}` } })
  const job = await parseJson(jobResponse)
  if (job.status !== 'completed' || !job.output_file_id) throw new Error('This batch has no completed output file.')
  const outputResponse = await fetch(`https://api.openai.com/v1/files/${encodeURIComponent(job.output_file_id)}/content`, { headers: { authorization: `Bearer ${key}` } })
  if (!outputResponse.ok) throw new Error(`Could not download batch output (${outputResponse.status})`)
  const lines = (await outputResponse.text()).split(/\r?\n/).filter(Boolean)
  const images = []
  for (const line of lines) {
    let item
    try { item = JSON.parse(line) } catch { continue }
    const body = item.response?.body || item.body || {}
    const imageData = body.data?.[0]
    if (item.error || !imageData) continue
    images.push({
      cardName: item.custom_id || item.id || 'batch-result',
      mimeType: imageData.b64_json ? 'image/png' : 'image/png',
      base64: imageData.b64_json || null,
      url: imageData.url || null,
    })
  }
  return images
}

export async function listCompletedJobs(provider, request) {
  const key = providerKey(provider, request)
  if (provider === 'openai') {
    const response = await fetch('https://api.openai.com/v1/batches?limit=100', { headers: { authorization: `Bearer ${key}` } })
    const body = await parseJson(response)
    return (body.data || []).map((job) => ({ id: job.id, status: job.status || 'unknown', createdAt: job.created_at, completedAt: job.completed_at, requestCounts: job.request_counts, outputFileId: job.output_file_id, errorFileId: job.error_file_id }))
  }
  throw new Error('Retrieving completed jobs is currently supported for OpenAI batches only.')
}

export async function generateImages(provider, request, payload) {
  const key = providerKey(provider, request)
  const promptWords = String(payload.prompt || '').trim().split(/\s+/).filter(Boolean)
  const hasCards = Array.isArray(payload.cards) && payload.cards.length > 0
  if (!payload.model || !payload.prompt || promptWords.length > 20000 || (!hasCards && (!Number.isInteger(payload.count) || payload.count < 1 || payload.count > 100))) throw new Error('model and prompt are required; batch count must be 1-100 when no card set is provided; prompt must be 20,000 words or fewer')
    if (payload.references && (!Array.isArray(payload.references) || payload.references.length > 1)) throw new Error('Exactly one reference image is supported')
    if (payload.references?.some((image) => !image?.mimeType || !image?.base64)) throw new Error('Each reference image must include mimeType and base64 data')
      if (payload.references?.some((image) => image.width && image.height && (image.width < 1 || image.height < 1))) throw new Error('Reference image dimensions must be positive')
      if (payload.cards && (!Array.isArray(payload.cards) || payload.cards.length < 1 || payload.cards.length > 100)) throw new Error('Card set must contain between 1 and 100 cards')
      if (payload.cards?.some((card) => !card.name || !card.description)) throw new Error('Each card must include a name and description')
  if (provider === 'openai') return createOpenAIImage({ key, ...payload })
  if (provider === 'gemini') return createGeminiImage({ key, ...payload })
  throw new Error(`Unsupported provider: ${provider}`)
}

export { JSON_HEADERS }
