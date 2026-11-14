import { DATA_BRANCH, REPO_NAME, REPO_OWNER } from '../model'

const API = 'https://api.github.com'

export class GithubError extends Error {
  status: number
  retryAt: number | null

  constructor(message: string, status: number, retryAt: number | null = null) {
    super(message)
    this.status = status
    this.retryAt = retryAt
  }
}

export interface RemoteFile {
  sha: string | null
  text: string | null
  etag: string | null
  notModified: boolean
}

interface RequestOptions {
  method?: string
  body?: unknown
  etag?: string | null
}

export class GithubClient {
  constructor(private readonly token: string) {}

  async getRef(): Promise<string | null> {
    const response = await this.request(`/repos/${REPO_OWNER}/${REPO_NAME}/git/ref/heads/${DATA_BRANCH}`)
    if (response.status === 404) return null
    if (!response.ok) await fail(response, 'Could not read the data branch')
    const body = (await response.json()) as { object: { sha: string } }
    return body.object.sha
  }

  async getFile(path: string, etag?: string | null): Promise<RemoteFile> {
    const response = await this.request(`/repos/${REPO_OWNER}/${REPO_NAME}/contents/${encodePath(path)}?ref=${DATA_BRANCH}`, {
      etag,
    })
    if (response.status === 304) return { sha: null, text: null, etag: etag ?? null, notModified: true }
    if (response.status === 404) return { sha: null, text: null, etag: null, notModified: false }
    if (!response.ok) await fail(response, `Could not read ${path}`)
    const body = (await response.json()) as { sha: string; content?: string; encoding?: string }
    const text = body.content ? decodeContent(body.content) : ''
    return { sha: body.sha, text, etag: response.headers.get('etag'), notModified: false }
  }

  async listEvents(): Promise<string[]> {
    const response = await this.request(`/repos/${REPO_OWNER}/${REPO_NAME}/contents/events?ref=${DATA_BRANCH}`)
    if (response.status === 404) return []
    if (!response.ok) await fail(response, 'Could not list sleep logs')
    const body = (await response.json()) as { name: string; type: string }[]
    if (!Array.isArray(body)) return []
    return body.filter((entry) => entry.type === 'file' && entry.name.endsWith('.json')).map((entry) => entry.name.replace(/\.json$/, ''))
  }

  async putFile(path: string, text: string, sha: string | null, message: string): Promise<{ blobSha: string; commitSha: string }> {
    const payload: Record<string, string> = {
      message,
      content: encodeContent(text),
      branch: DATA_BRANCH,
    }
    if (sha) payload.sha = sha
    const response = await this.request(`/repos/${REPO_OWNER}/${REPO_NAME}/contents/${encodePath(path)}`, {
      method: 'PUT',
      body: payload,
    })
    if (!response.ok) await fail(response, `Could not save ${path}`)
    const body = (await response.json()) as { content: { sha: string }; commit: { sha: string } }
    return { blobSha: body.content.sha, commitSha: body.commit.sha }
  }

  async createDataBranch(profileText: string): Promise<string> {
    const blobResponse = await this.request(`/repos/${REPO_OWNER}/${REPO_NAME}/git/blobs`, {
      method: 'POST',
      body: { content: encodeContent(profileText), encoding: 'base64' },
    })
    if (!blobResponse.ok) await fail(blobResponse, 'Could not create the data branch')
    const blob = (await blobResponse.json()) as { sha: string }
    const treeResponse = await this.request(`/repos/${REPO_OWNER}/${REPO_NAME}/git/trees`, {
      method: 'POST',
      body: { tree: [{ path: 'profile.json', mode: '100644', type: 'blob', sha: blob.sha }] },
    })
    if (!treeResponse.ok) await fail(treeResponse, 'Could not create the data branch')
    const tree = (await treeResponse.json()) as { sha: string }
    const commitResponse = await this.request(`/repos/${REPO_OWNER}/${REPO_NAME}/git/commits`, {
      method: 'POST',
      body: { message: 'Start Twin Napper logs', tree: tree.sha, parents: [] },
    })
    if (!commitResponse.ok) await fail(commitResponse, 'Could not create the data branch')
    const commit = (await commitResponse.json()) as { sha: string }
    const refResponse = await this.request(`/repos/${REPO_OWNER}/${REPO_NAME}/git/refs`, {
      method: 'POST',
      body: { ref: `refs/heads/${DATA_BRANCH}`, sha: commit.sha },
    })
    if (refResponse.status === 422) {
      const existing = await this.getRef()
      if (existing) return existing
    }
    if (!refResponse.ok) await fail(refResponse, 'Could not create the data branch')
    return commit.sha
  }

  async test(): Promise<string> {
    const response = await this.request(`/repos/${REPO_OWNER}/${REPO_NAME}`)
    if (response.status === 401) throw new GithubError('GitHub rejected this token', 401)
    if (!response.ok) await fail(response, 'Could not open the repository')
    const ref = await this.getRef()
    return ref
      ? `Connected to ${REPO_OWNER}/${REPO_NAME}. Data branch is ready.`
      : `Connected to ${REPO_OWNER}/${REPO_NAME}. The data branch will be created on the first save.`
  }

  private async request(path: string, options: RequestOptions = {}): Promise<Response> {
    const headers = new Headers({
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      Authorization: `Bearer ${this.token}`,
    })
    if (options.body) headers.set('Content-Type', 'application/json')
    if (options.etag) headers.set('If-None-Match', options.etag)
    return fetch(`${API}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: 'no-store',
    })
  }
}

async function fail(response: Response, fallback: string): Promise<never> {
  let message = fallback
  try {
    const body = (await response.json()) as { message?: string }
    if (body.message) message = body.message
  } catch {
    // Keep the fallback text when GitHub returns an empty error body.
  }
  const remaining = response.headers.get('x-ratelimit-remaining')
  const reset = response.headers.get('x-ratelimit-reset')
  const retryAt = remaining === '0' && reset ? Number(reset) * 1000 : response.status === 429 ? Date.now() + 60_000 : null
  throw new GithubError(message, response.status, retryAt)
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

export function encodeContent(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

export function decodeContent(encoded: string): string {
  const binary = atob(encoded.replace(/\s/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new TextDecoder().decode(bytes)
}
