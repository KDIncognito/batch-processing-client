import http from 'node:http'
import { generateImages, listModels, listCompletedJobs, JSON_HEADERS } from './providers.js'

const port = Number(process.env.PORT || 8787)
const allowedOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173'

function send(response, status, body) {
  response.writeHead(status, { ...JSON_HEADERS, 'access-control-allow-origin': allowedOrigin, 'access-control-allow-headers': 'content-type, x-provider-api-key', 'access-control-allow-methods': 'GET, POST, OPTIONS' })
  response.end(JSON.stringify(body))
}

async function bodyOf(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

const server = http.createServer(async (request, response) => {
  if (request.method === 'OPTIONS') return send(response, 204, {})
  try {
    const url = new URL(request.url, `http://${request.headers.host}`)
    if (request.method === 'GET' && url.pathname === '/health') return send(response, 200, { ok: true })
    const jobsMatch = url.pathname.match(/^\/api\/providers\/(openai|gemini)\/jobs$/)
    if (request.method === 'GET' && jobsMatch) return send(response, 200, { provider: jobsMatch[1], jobs: await listCompletedJobs(jobsMatch[1], request) })
    const resultsMatch = url.pathname.match(/^\/api\/providers\/(openai|gemini)\/jobs\/([^/]+)\/results$/)
    if (request.method === 'GET' && resultsMatch) return send(response, 200, { provider: resultsMatch[1], images: await downloadJobResults(resultsMatch[1], resultsMatch[2], request) })
    const modelsMatch = url.pathname.match(/^\/api\/providers\/(openai|gemini)\/models$/)
    if (request.method === 'GET' && modelsMatch) return send(response, 200, { provider: modelsMatch[1], models: await listModels(modelsMatch[1], request) })
    const batchMatch = url.pathname.match(/^\/api\/providers\/(openai|gemini)\/generate$/)
    if (request.method === 'POST' && batchMatch) return send(response, 200, { provider: batchMatch[1], images: await generateImages(batchMatch[1], request, await bodyOf(request)) })
    return send(response, 404, { error: 'Not found' })
  } catch (error) {
    console.error(error)
    return send(response, 400, { error: error.message || 'Request failed' })
  }
})

server.listen(port, () => console.log(`Batchroom API listening on http://localhost:${port}`))
