import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  ArrowLeft, ArrowRight, Check, ChevronDown, CircleHelp, Download, FileText,
  FolderOpen, ImagePlus, KeyRound, LoaderCircle, LockKeyhole, Play,
  RotateCcw, Sparkles, Upload, X
} from 'lucide-react'
import './styles.css'
import ImageEditor from './ImageEditor'
import TextExtractor from './TextExtractor'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8787'
const MAX_PROMPT_WORDS = 20000
const PROVIDERS = {
  openai: { name: 'OpenAI' },
  gemini: { name: 'Google Gemini' },
}

const BULK_MODELS = {
  openai: [
    { id: 'gpt-image-1', name: 'GPT Image 1', detail: 'OpenAI image model', pricePerImage: 0.04 },
    { id: 'dall-e-3', name: 'DALL·E 3', detail: 'OpenAI image model', pricePerImage: 0.08 },
  ],
  gemini: [
    { id: 'imagen-3', name: 'Imagen 3', detail: 'Google image model', pricePerImage: 0.05 },
    { id: 'gemini-2.0-flash-exp', name: 'Gemini 2.0 Flash', detail: 'Google image model', pricePerImage: 0.02 },
  ],
}

const QUALITY_OPTIONS = {
  openai: [
    { value: 'low', label: 'Low quality' },
    { value: 'medium', label: 'Medium quality' },
    { value: 'high', label: 'High quality' },
  ],
  gemini: [
    { value: '512', label: '512px' },
    { value: '1k', label: '1K' },
    { value: '2k', label: '2K' },
    { value: '4k', label: '4K' },
  ],
}

function inferPromptCount(promptText) {
  const match = String(promptText || '').match(/\[batch:\s*(\d{1,3})\s*\]/i)
  const count = match ? Number(match[1]) : null
  return count && count >= 1 && count <= 100 ? count : null
}

function safeFileName(value) {
  return String(value || 'image').replace(/[^a-z0-9]+/gi, '').replace(/^-+|-+$/g, '') || 'image'
}

function imageFileName(image, index) {
  const extension = image.mimeType?.includes('jpeg') ? 'jpeg' : 'png'
  return `${safeFileName(image.cardName || `image-${index + 1}`)}.${extension}`
}

async function imageBlob(image) {
  if (image.base64) {
    const binary = atob(image.base64)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    return new Blob([bytes], { type: image.mimeType || 'image/png' })
  }
  if (image.url) {
    const response = await fetch(image.url)
    if (!response.ok) throw new Error(`Image download failed (${response.status})`)
    return response.blob()
  }
  throw new Error('Provider returned no image data')
}

async function downloadImage(image, index) {
  const extension = image.mimeType?.includes('jpeg') ? 'jpeg' : 'png'
  const label = image.cardName || `image-${index + 1}`
  const anchor = document.createElement('a')
  anchor.download = imageFileName(image, index)
  if (image.base64) anchor.href = `data:${image.mimeType || 'image/png'};base64,${image.base64}`
  else if (image.url) anchor.href = image.url
  else throw new Error('Provider returned no image data')
  anchor.click()
}

async function saveImageToFolder(directoryHandle, image, index) {
  if (!directoryHandle) return false
  const fileHandle = await directoryHandle.getFileHandle(imageFileName(image, index), { create: true })
  const writable = await fileHandle.createWritable()
  try {
    await writable.write(await imageBlob(image))
    await writable.close()
  } catch (saveError) {
    await writable.abort()
    throw saveError
  }
  return true
}

function normalizeCardEntries(entries) {
  return entries.slice(0, 100).map(([key, description], index) => {
    const separator = key.indexOf(':')
    return {
      index,
      number: separator >= 0 ? key.slice(0, separator).trim() : '',
      name: separator >= 0 ? key.slice(separator + 1).trim() : key.trim(),
      description: String(description).trim(),
    }
  }).filter((card) => card.name && card.description)
}

function parseCardSet(promptText) {
  const text = String(promptText || '')
  const objectStart = text.indexOf('{')
  const objectEnd = text.lastIndexOf('}')
  if (objectStart >= 0 && objectEnd > objectStart) {
    const objectText = text.slice(objectStart, objectEnd + 1)
    try {
      const parsed = JSON.parse(objectText.replace(/[“”]/g, '"').replace(/[‘’]/g, "'"))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return normalizeCardEntries(Object.entries(parsed))
    } catch {
      // Fall through to the quoted-entry parser for JSON-like prompts.
    }
  }

  const cards = []
  const entryPattern = /["'“”]([^"'“”]+?)["'“”]\s*:\s*["'“”]((?:\\.|[^"'“”])*)["'“”](?=\s*,?)/g
  let match
  while ((match = entryPattern.exec(text)) !== null) cards.push([match[1].trim(), match[2].replace(/\\(["'\\])/g, '$1').trim()])
  return normalizeCardEntries(cards)
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function readImageSize(file) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = reject
    image.src = URL.createObjectURL(file)
  })
}

async function readImageDimension(file, dimension) {
  const size = await readImageSize(file)
  return size[dimension]
}

function App() {
  const [screen, setScreen] = useState('home')
  const [provider, setProvider] = useState('openai')
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [models, setModels] = useState(BULK_MODELS.openai)
  const [model, setModel] = useState('')
  const [modelsLoading, setModelsLoading] = useState(false)
  const [references, setReferences] = useState([])
  const [prompt, setPrompt] = useState('')
  const [promptFileName, setPromptFileName] = useState('')
  const [count, setCount] = useState(4)
  const [quality, setQuality] = useState('medium')
  const [apiOnline, setApiOnline] = useState(true)
  const [outputFolder, setOutputFolder] = useState('Downloads')
  const [outputDirectoryHandle, setOutputDirectoryHandle] = useState(null)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('Preparing your batch…')
  const [error, setError] = useState('')
  const [batchResult, setBatchResult] = useState(null)
  const cardSet = useMemo(() => parseCardSet(prompt), [prompt])
  const inferredCount = useMemo(() => inferPromptCount(prompt), [prompt])
  const jobCount = cardSet.length || inferredCount || 0
  const fileInput = useRef(null)
  const promptFileInput = useRef(null)
  const [oldJobs, setOldJobs] = useState([])
  const [jobsLoading, setJobsLoading] = useState(false)
  const [jobsDownloaded, setJobsDownloaded] = useState(0)
  const [jobsChecked, setJobsChecked] = useState(false)

  const selectedModel = useMemo(() => models.find((item) => item.id === model), [model, models])
  const estimate = (selectedModel?.pricePerImage || 0) * count
  const canStart = apiKey.trim() && prompt.trim() && model && prompt.trim() && references.length > 0 && jobCount > 0 && !modelsLoading
  const qualityOptions = QUALITY_OPTIONS[provider]

  const fetchModels = async () => {
    setModelsLoading(true)
    setError('')
    try {
      const response = await fetch(`${API_URL}/api/providers/${provider}/models`, {
        headers: { 'x-provider-api-key': apiKey },
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Could not load models')
      const discoveredModels = body.models.map((item) => {
        const bulkModel = BULK_MODELS[provider].find((fallback) => fallback.id === item.id)
        return { ...item, pricePerImage: item.pricePerImage ?? bulkModel?.pricePerImage ?? null }
      })
      const nextModels = discoveredModels.length ? discoveredModels : BULK_MODELS[provider]
      setModels(nextModels)
      setModel((current) => nextModels.some((item) => item.id === current) ? current : nextModels[0]?.id || '')
      if (!discoveredModels.length) setError('Live model discovery returned no image models. Showing bulk API rates.')
    } catch (loadError) {
      const message = loadError instanceof TypeError && loadError.message === 'Failed to fetch'
        ? `Cannot reach the application API at ${API_URL}. Start it with npm run api or check VITE_API_URL.`
        : loadError.message
      setApiOnline(false)
      setModels(BULK_MODELS[provider])
      setModel((current) => BULK_MODELS[provider].some((item) => item.id === current) ? current : BULK_MODELS[provider][0]?.id || '')
      setError(message)
    } finally {
      setModelsLoading(false)
    }
  }

  useEffect(() => {
    const nextDefault = QUALITY_OPTIONS[provider][0].value
    setQuality(nextDefault)
  }, [provider])

  useEffect(() => {
    if (!apiKey.trim()) {
      const fallbackModels = BULK_MODELS[provider]
      setModels(fallbackModels)
      setModel(fallbackModels[0]?.id || '')
      setModelsLoading(false)
      setError('')
      return undefined
    }
    setModels(BULK_MODELS[provider])
    setModel(BULK_MODELS[provider][0]?.id || '')
    if (!apiKey.trim()) {
      setModelsLoading(false)
      setError('')
      return undefined
    }
    fetchModels()
    return undefined
  }, [apiKey, provider])

  const chooseFolder = async () => {
    if ('showDirectoryPicker' in window) {
      try {
        const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
        setOutputDirectoryHandle(handle)
        setOutputFolder(handle.name)
        return
      } catch (folderError) {
        if (folderError.name !== 'AbortError') setError(`Could not access the selected folder: ${folderError.message}`)
        return
      }
    }
    setOutputFolder('Downloads / batchroom-output')
  }

  const loadPromptFile = async (file) => {
    if (!file) return
    const text = await file.text()
    const words = text.trim().split(/\s+/).filter(Boolean)
    if (words.length > MAX_PROMPT_WORDS) {
      setError(`Prompt files must contain ${MAX_PROMPT_WORDS.toLocaleString()} words or fewer.`)
      return
    }
    setPrompt(text)
    setPromptFileName(file.name)
    setError('')
  }

  const addFiles = (files) => {
    const images = Array.from(files).filter((file) => file.type.startsWith('image/'))
    setReferences(images.slice(0, 1))
  }

  const retrieveOldJobs = async () => {
    setJobsLoading(true)
    setError('')
    setJobsDownloaded(0)
    try {
      const response = await fetch(`${API_URL}/api/providers/${provider}/jobs`, { headers: { 'x-provider-api-key': apiKey } })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Could not retrieve completed jobs')
      setOldJobs(body.jobs || [])
      setJobsChecked(true)
    } catch (loadError) {
      setJobsChecked(false)
      setError(loadError instanceof TypeError && loadError.message === 'Failed to fetch' ? `Cannot reach the application API at ${API_URL}.` : loadError.message)
    } finally {
      setJobsLoading(false)
    }
  }

  useEffect(() => {
    if (screen === 'retrieve' && apiKey.trim()) retrieveOldJobs()
  }, [screen])

  const downloadOldJobResults = async (job) => {
    if (!job.outputFileId) throw new Error(`Job ${job.id} has no output file.`)
    const response = await fetch(`${API_URL}/api/providers/${provider}/jobs/${encodeURIComponent(job.id)}/results`, { headers: { 'x-provider-api-key': apiKey } })
    const body = await response.json()
    if (!response.ok) throw new Error(body.error || `Could not download ${job.id}`)
    for (let index = 0; index < body.images.length; index += 1) {
      const image = body.images[index]
      if (outputDirectoryHandle) await saveImageToFolder(outputDirectoryHandle, image, index)
      else await downloadImage(image, index)
      setJobsDownloaded((value) => value + 1)
    }
  }

  const downloadAllOldJobs = async () => {
    setError('')
    try {
      for (const job of oldJobs.filter((item) => item.status === 'completed' && item.outputFileId)) await downloadOldJobResults(job)
    } catch (downloadError) {
      setError(downloadError.message)
    }
  }

  const startBatch = async (event) => {
    event.preventDefault()
    if (!canStart) {
      setError(jobCount > 0 ? 'Add an API key, reference image, modification prompt, model, and output folder to continue.' : 'Include the batch marker in the prompt, for example “[batch: 3]”.')
      return
    }
    setError('')
    setProgress(0)
    setStatus(references.length ? 'Reading the reference image and sending the card prompt…' : 'Sending your batch to the provider…')
    setScreen('progress')
    try {
      const referenceData = await Promise.all(references.map(async (file) => ({
              mimeType: file.type,
              base64: await fileToBase64(file),
              width: await readImageDimension(file, 'width'),
              height: await readImageDimension(file, 'height'),
            })))
      const response = await fetch(`${API_URL}/api/providers/${provider}/generate`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-provider-api-key': apiKey },
        body: JSON.stringify({
                  model,
                  prompt,
                  count: jobCount,
                  quality,
                  cards: cardSet.length ? cardSet : undefined,
                  ...(referenceData.length ? { references: referenceData } : {}),
                }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Batch generation failed')
      const generatedImages = body.images || []
      setBatchResult(generatedImages)
      if (generatedImages.length) {
        let saved = 0
        if (outputDirectoryHandle) {
          for (let index = 0; index < generatedImages.length; index += 1) {
            await saveImageToFolder(outputDirectoryHandle, generatedImages[index], index)
            saved += 1
            setProgress(saved)
            setStatus(`Saved image ${saved} of ${generatedImages.length} to ${outputFolder}…`)
          }
        } else {
          setStatus(`Packaging ${generatedImages.length} images into one ZIP…`)
          await downloadImagesAsZip(generatedImages, 'tarot-symbolic-cards.zip')
          saved = generatedImages.length
          setProgress(saved)
        }
        setStatus(`Task completed. Saved ${saved} image${saved === 1 ? '' : 's'} ${outputDirectoryHandle ? `to ${outputFolder}` : 'as one ZIP in Downloads'}.`)
      } else {
        setProgress(0)
        setStatus('The provider returned no images.')
      }
    } catch (generationError) {
      setError(generationError instanceof TypeError && generationError.message === 'Failed to fetch'
        ? `Cannot reach the application API at ${API_URL}. Start it with npm run api or check VITE_API_URL.`
        : generationError.message)
      setStatus('Batch failed before all images could be saved.')
      setStatus('Batch failed.')
      setScreen('setup')
    }
  }

  const downloadImagesAsZip = async (images, zipName = 'tarot-symbolic-cards.zip') => {
    if (!images?.length) return
    const files = []
    for (let index = 0; index < images.length; index += 1) {
      files.push({ name: imageFileName(images[index], index), data: new Uint8Array(await (await imageBlob(images[index])).arrayBuffer()) })
    }
    const encoder = new TextEncoder()
    const chunks = []
    const central = []
    let offset = 0
    const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
    const crc32 = (data) => data.reduce((crc, byte) => crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8), 0xffffffff) ^ 0xffffffff
    const u16 = (value) => new Uint8Array([value & 255, (value >>> 8) & 255])
    const u32 = (value) => new Uint8Array([value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255])
    const join = (parts) => { const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0)); let cursor = 0; parts.forEach((part) => { output.set(part, cursor); cursor += part.length }); return output }
    files.forEach((file) => { const name = encoder.encode(file.name); const crc = crc32(file.data); const local = join([new Uint8Array([80, 75, 3, 4]), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(file.data.length), u32(file.data.length), u16(name.length), u16(0), name, file.data]); chunks.push(local); central.push(join([new Uint8Array([80, 75, 1, 2]), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(file.data.length), u32(file.data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name])); offset += local.length })
    const centralData = join(central); const body = join([...chunks, centralData, new Uint8Array([80, 75, 5, 6]), u16(0), u16(0), u16(files.length), u16(files.length), u32(centralData.length), u32(offset), u16(0)])
    const anchor = document.createElement('a'); anchor.download = zipName; anchor.href = URL.createObjectURL(new Blob([body], { type: 'application/zip' })); anchor.click(); setTimeout(() => URL.revokeObjectURL(anchor.href), 1000)
  }

  const downloadBatchZip = async () => downloadImagesAsZip(batchResult, 'tarot-symbolic-cards.zip')

  const reset = () => {
    setProgress(0)
    setStatus('Preparing your batch…')
    setBatchResult(null)
    setScreen('setup')
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Batchroom home"><span className="brand-mark"><Sparkles size={17} /></span> batchroom</a>
        <div className="topbar-right"><span className="session-dot" /> Session-only mode <CircleHelp size={16} /></div>
      </header>

      <main className="main-content">
        {screen === 'home' ? (
          <section className="action-choice-screen">
            <div className="eyebrow"><span className="eyebrow-line" /> BATCHROOM</div>
            <div className="intro-row"><div><h1>What would you like to <em>do?</em></h1><p className="subtitle">Continue an existing batch or start a new image generation job.</p></div><div className="step-count">00 <span>/ 02</span></div></div>
            <div className="action-choice-grid">
              <button className="action-choice-card" type="button" onClick={() => setScreen('retrieve')}><span className="action-choice-icon"><Download size={22} /></span><strong>Retrieve old jobs</strong><p>Find completed successful batches and download their results.</p><span className="action-choice-link">Retrieve results <ArrowRight size={16} /></span></button>
              <button className="action-choice-card" type="button" onClick={() => setScreen('setup')}><span className="action-choice-icon"><Play size={22} fill="currentColor" /></span><strong>Start a new batch</strong><p>Use the existing workflow to configure and generate a new batch.</p><span className="action-choice-link">Create a batch <ArrowRight size={16} /></span></button>
                            <button className="action-choice-card" type="button" onClick={() => setScreen('editor')}><span className="action-choice-icon"><ImagePlus size={22} /></span><strong>Edit images</strong><p>Crop, colour-correct and layer up to 100 PNG or JPEG images.</p><span className="action-choice-link">Open editor <ArrowRight size={16} /></span></button>
                                          <button className="action-choice-card" type="button" onClick={() => setScreen('extract')}><span className="action-choice-icon"><FileText size={22} /></span><strong>Extract text</strong><p>Read text from a supplied set of cropped images locally.</p><span className="action-choice-link">Open extractor <ArrowRight size={16} /></span></button>
            </div>
          </section>
        ) : screen === 'editor' ? (
          <ImageEditor onBack={() => setScreen('home')} />
        ) : screen === 'extract' ? (
          <TextExtractor onBack={() => setScreen('home')} />
        ) : screen === 'retrieve' ? (
          <section className="retrieve-screen">
            <div className="eyebrow"><span className="eyebrow-line" /> RETRIEVE OLD JOBS</div>
            <div className="intro-row"><div><h1>Recover your <em>completed work.</em></h1><p className="subtitle">Only successful completed jobs are shown. Results are downloaded to your selected destination.</p></div><button className="back-link" type="button" onClick={() => setScreen('home')}><ArrowLeft size={16} /> Choose another action</button></div>
            <section className="section first-section"><div className="section-heading"><span className="section-number">01</span><div><h2>Connect your provider</h2><p>Your key stays in this browser session and is never stored.</p></div></div><div className="provider-key-row"><label className="field-label">AI SERVICE PROVIDER<span className="select-wrap"><select value={provider} onChange={(event) => setProvider(event.target.value)}><option value="openai">OpenAI</option><option value="gemini">Google Gemini</option></select><ChevronDown size={16} /></span></label><label className="field-label key-field">API KEY<span className="input-wrap"><KeyRound size={16} /><input type={showKey ? 'text' : 'password'} value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Paste your key" autoComplete="off" /><button type="button" onClick={() => setShowKey(!showKey)}>{showKey ? 'Hide' : 'Show'}</button></span></label></div></section>
            <section className="section"><div className="section-heading"><span className="section-number">02</span><div><h2>Choose a destination</h2><p>Pick a folder when supported, or use your browser’s Downloads folder.</p></div></div><div className="save-row"><label className="field-label save-field">SAVE OUTPUTS TO<span className="input-wrap folder-input"><FolderOpen size={16} /><input value={outputFolder} readOnly /><button type="button" onClick={chooseFolder}>Choose</button></span></label><button className="go-button" type="button" onClick={async () => { await retrieveOldJobs() }} disabled={!apiKey.trim() || jobsLoading}><Download size={16} /> {jobsLoading ? 'Finding jobs…' : 'Find completed jobs'} <ArrowRight size={17} /></button></div></section>
            {jobsChecked && <section className="section"><div className="section-heading"><span className="section-number">03</span><div><h2>Job status tracker</h2><p>All recent batch jobs are shown by status. Only completed jobs with output files can be downloaded.</p></div></div><div className="status-grid">{['completed', 'in_progress', 'validating', 'finalizing', 'failed', 'expired', 'cancelling', 'cancelled', 'unknown'].map((status) => <div className={`status-card status-${status}`} key={status}><strong>{oldJobs.filter((job) => job.status === status).length}</strong><span>{status.replaceAll('_', ' ')}</span></div>)}</div><div className="old-jobs-list">{oldJobs.map((job) => <div className="old-job-row" key={job.id}><div><strong>{job.id}</strong><small>{job.status.replaceAll('_', ' ')} · {job.outputFileId ? 'Results available' : 'No output file'}</small></div>{job.status === 'completed' && job.outputFileId ? <Check size={17} /> : <span className="job-status-dot" />}</div>)}</div><button className="go-button retrieve-all-button" type="button" onClick={downloadAllOldJobs} disabled={!oldJobs.some((job) => job.status === 'completed' && job.outputFileId)}><Download size={16} /> Download all successful results <ArrowRight size={17} /></button>{jobsDownloaded > 0 && <p className="secure-note"><Check size={14} /> Downloaded {jobsDownloaded} result{jobsDownloaded === 1 ? '' : 's'}</p>}</section>}
            {jobsChecked && oldJobs.length === 0 && <p className="empty-state">No batch jobs were found.</p>}
            {error && <p className="form-error">{error}</p>}
          </section>
        ) : screen === 'setup' ? (
          <form onSubmit={startBatch}>
            <div className="eyebrow"><span className="eyebrow-line" /> NEW BATCH</div>
            <div className="intro-row">
              <div><h1>Turn a prompt into a <em>batch.</em></h1><p className="subtitle">Generate a set of images, locally and securely.</p></div>
              <div className="step-count">01 <span>/ 02</span></div>
            </div>

            <section className="section first-section">
              <div className="section-heading"><span className="section-number">01</span><div><h2>Connect your provider</h2><p>Your key stays in this browser session and is never stored.</p></div></div>
              <div className="provider-key-row">
                <label className="field-label">AI SERVICE PROVIDER
                  <span className="select-wrap"><select value={provider} onChange={(event) => setProvider(event.target.value)}>{Object.entries(PROVIDERS).map(([id, item]) => <option key={id} value={id}>{item.name}</option>)}</select><ChevronDown size={16} /></span>
                </label>
                <label className="field-label key-field">API KEY
                  <span className="input-wrap"><KeyRound size={16} /><input type={showKey ? 'text' : 'password'} value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Paste your key" autoComplete="off" /><button type="button" onClick={() => setShowKey(!showKey)}>{showKey ? 'Hide' : 'Show'}</button></span>
                </label>
              </div>
              <div className="secure-note"><LockKeyhole size={14} /> Encrypted in memory <span>·</span> Cleared when you close this tab</div>
            </section>

            <section className="section">
              <div className="section-heading"><span className="section-number">02</span><div><h2>Shape your batch</h2><p>Choose a model and define how many variations you need.</p></div></div>
              <label className="model-select field-label"><span className="model-label-row">IMAGE GENERATION MODEL <button className="refresh-models" type="button" onClick={fetchModels} disabled={modelsLoading || !apiKey.trim()} title="Refresh available image models" aria-label="Refresh available image models"><RotateCcw size={13} className={modelsLoading ? 'spin' : ''} /> Refresh</button></span><select value={model} onChange={(event) => setModel(event.target.value)} disabled={modelsLoading || !models.length}><option value="">{modelsLoading ? 'Loading available models…' : 'Select a model'}</option>{models.map((item) => <option value={item.id} key={item.id}>{item.name} / {item.pricePerImage == null ? 'rate unavailable' : `$${item.pricePerImage.toFixed(2)}/image`}</option>)}</select></label>
              <div className="batch-options"><div className="inferred-count field-label">{cardSet.length ? 'CARD SET SIZE' : 'INFERRED IMAGE COUNT'}<span className="number-wrap"><strong>{jobCount || '—'}</strong><span>{cardSet.length ? 'cards' : 'images'}</span></span></div><label className="field-label">QUALITY / RESOLUTION<select className="quality-select" value={quality} onChange={(event) => setQuality(event.target.value)}>{qualityOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label><div className="cost-card"><span>ESTIMATED COST</span><strong>{selectedModel?.pricePerImage == null ? '—' : `$${estimate.toFixed(2)}`}</strong><small>{selectedModel?.pricePerImage == null ? 'Provider pricing unavailable' : `${count} images × $${selectedModel.pricePerImage.toFixed(2)}`}</small></div></div>
            </section>

            <section className="section">
              <div className="section-heading"><span className="section-number">03</span><div><h2>Add reference images <span className="required">CORE USE CASE</span></h2><p>Upload one reference image to use as the visual basis for every generated card.</p></div></div>
              <div className="dropzone" onClick={() => fileInput.current?.click()} onDrop={(event) => { event.preventDefault(); addFiles(event.dataTransfer.files) }} onDragOver={(event) => event.preventDefault()}><input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(event) => addFiles(event.target.files)} /><div className="upload-icon"><Upload size={18} /></div><strong>Drop one image to use as your card reference or <span>browse</span></strong><small>PNG, JPG or WEBP · Max 10MB</small></div>
              {references.length > 0 && <div className="reference-list">{references.map((file, index) => <div className="reference-chip" key={`${file.name}-${index}`}><span className="reference-placeholder">{index + 1}</span><ImagePlus size={15} /><span>{file.name}</span><small>Same prompt</small><button type="button" onClick={() => setReferences((items) => items.filter((_, i) => i !== index))}><X size={14} /></button></div>)}</div>}
            </section>

            <section className="section final-section">
              <div className="section-heading"><span className="section-number">04</span><div><h2>Describe the modification</h2><p>{references.length ? (cardSet.length ? `${cardSet.length} card specifications detected: ${cardSet.map((card) => `${card.number ? `${card.number} ` : ''}${card.name}`).join(', ')}.` : inferredCount ? `The prompt requests ${inferredCount} images. The same reference image will be used for the batch.` : `Include a batch marker such as “[batch: 3]” to define the batch size.`) : `Upload one reference image first, then describe the card set.`}</p></div></div>
              <label className="field-label prompt-label">PROMPT <span className="required">REQUIRED</span><div className="prompt-toolbar"><button className="prompt-upload" type="button" onClick={() => promptFileInput.current?.click()}><Upload size={14} /> Upload prompt file</button>{promptFileName && <span className="prompt-file-name">{promptFileName}</span>}<input ref={promptFileInput} type="file" accept=".txt,.md,.json,text/plain,text/markdown,application/json" hidden onChange={(event) => loadPromptFile(event.target.files?.[0])} /></div><textarea value={prompt} onChange={(event) => { const next = event.target.value; if (next.trim().split(/\s+/).filter(Boolean).length <= MAX_PROMPT_WORDS) { setPrompt(next); setPromptFileName('') } }} placeholder="Describe how to create cards from the reference image…" /><span className="character-count">{prompt.trim().split(/\s+/).filter(Boolean).length} / {MAX_PROMPT_WORDS} words</span></label>
              <div className="save-row"><label className="field-label save-field">SAVE OUTPUTS TO <span className="required">REQUIRED</span><span className="input-wrap folder-input"><FolderOpen size={16} /><input value={outputFolder} readOnly placeholder="Downloads (default)" /><button type="button" onClick={chooseFolder}>Choose</button></span></label><button className="go-button" type="submit"><Play size={16} fill="currentColor" /> Start batch <ArrowRight size={17} /></button></div>
              {error && <p className="form-error">{error}</p>}
            </section>
          </form>
        ) : (
          <div className="progress-screen"><div className="eyebrow"><span className="eyebrow-line" /> BATCH IN PROGRESS</div><div className="progress-heading"><div><h1>{progress >= count ? <>Your batch is <em>complete.</em></> : <>Creating your <em>batch.</em></>}</h1><p className="subtitle">{status}</p></div><div className="progress-number">{String(Math.round((progress / count) * 100)).padStart(2, '0')}<span>%</span></div></div><div className="progress-card"><div className="progress-meta"><span>{progress >= count ? 'TASK COMPLETED' : 'GENERATING IMAGES'}</span><strong>{progress} <small>/ {count}</small></strong></div><div className="progress-track"><div className="progress-fill" style={{ width: `${(progress / count) * 100}%` }} /></div><div className="progress-details"><span>{progress >= count ? <><Check size={15} /> Generated images ready</> : <><LoaderCircle size={15} className="spin" /> This may take a moment…</>}</span><span>{Math.max(0, count - progress)} remaining</span></div></div>{batchResult?.length > 0 && <div className="result-actions"><button className="secondary-button" type="button" onClick={downloadBatchZip}><Download size={15} /> Download ZIP</button>{batchResult.map((image, index) => <button className="secondary-button" type="button" onClick={() => downloadImage(image, index)} key={index}><Download size={15} /> {imageFileName(image, index)}</button>)}</div>}<div className="batch-summary"><div><span>MODEL</span><strong>{selectedModel?.name || model}</strong></div><div><span>REFERENCES</span><strong>{references.length ? `${references.length} images` : 'None added'}</strong></div><div><span>ESTIMATED COST</span><strong>${estimate.toFixed(2)}</strong></div></div><button className="secondary-button" type="button" onClick={reset}>{progress >= count ? <><RotateCcw size={16} /> Start another batch</> : <><ArrowLeft size={16} /> Back to setup</>}</button></div>
        )}
      </main>
      <footer><span>batchroom v0.1</span><span>Local-first · Your data stays yours</span></footer>
    </div>
  )
}

createRoot(document.getElementById('root')).render(<App />)
