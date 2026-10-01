// Cliente mínimo de la API de GitHub para publicar el contenido cifrado.
// Publica varios archivos en un solo commit (Git Data API) y detecta si la rama
// cambió mientras el admin editaba.
import type { Bytes } from '../shared/crypto.ts'

export interface RepoConfig {
  owner: string
  repo: string
  branch: string
  token: string
}

export interface FileChange {
  path: string
  // null borra el archivo.
  bytes: Bytes | null
}

export class GitHubError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'GitHubError'
  }
}

export class AuthError extends GitHubError {
  constructor(status: number) {
    super(status, 'GitHub rechazó el token (vencido o sin permiso sobre el repo)')
    this.name = 'AuthError'
  }
}

export class ConflictError extends GitHubError {
  constructor() {
    super(422, 'Alguien publicó cambios mientras editabas')
    this.name = 'ConflictError'
  }
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>

const CHUNK = 0x8000

export function toBase64(bytes: Bytes): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

export class GitHubRepo {
  private readonly base: string

  constructor(
    private readonly config: RepoConfig,
    private readonly fetchFn: Fetch = (url, init) => fetch(url, init),
  ) {
    this.base = `https://api.github.com/repos/${config.owner}/${config.repo}`
  }

  private async request(path: string, init: RequestInit = {}, accept = 'application/vnd.github+json'): Promise<Response> {
    const response = await this.fetchFn(`${this.base}${path}`, {
      ...init,
      headers: {
        Accept: accept,
        Authorization: `Bearer ${this.config.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    })
    if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
      throw new GitHubError(403, 'GitHub está limitando los pedidos. Probá de nuevo en unos minutos.')
    }
    if (response.status === 401 || response.status === 403) throw new AuthError(response.status)
    return response
  }

  private async json<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.request(path, init)
    if (!response.ok) throw new GitHubError(response.status, `GitHub respondió ${response.status} en ${path}`)
    return (await response.json()) as T
  }

  private post<T>(path: string, body: unknown): Promise<T> {
    return this.json<T>(path, { method: 'POST', body: JSON.stringify(body) })
  }

  async headCommit(): Promise<string> {
    const ref = await this.json<{ object: { sha: string } }>(`/git/ref/heads/${this.config.branch}`)
    return ref.object.sha
  }

  async readFile(path: string, ref: string): Promise<Bytes | null> {
    const response = await this.request(`/contents/${path}?ref=${ref}`, {}, 'application/vnd.github.raw+json')
    if (response.status === 404) return null
    if (!response.ok) throw new GitHubError(response.status, `No se pudo leer ${path}`)
    return new Uint8Array(await response.arrayBuffer())
  }

  async listFiles(path: string, ref: string): Promise<string[]> {
    const response = await this.request(`/contents/${path}?ref=${ref}`)
    if (response.status === 404) return []
    if (!response.ok) throw new GitHubError(response.status, `No se pudo listar ${path}`)
    const entries = (await response.json()) as { name: string; type: string }[]
    return entries.filter((e) => e.type === 'file').map((e) => e.name)
  }

  async commitFiles(baseCommit: string, files: FileChange[], message: string): Promise<string> {
    const base = await this.json<{ tree: { sha: string } }>(`/git/commits/${baseCommit}`)
    const tree = []
    for (const file of files) {
      const sha = file.bytes
        ? (await this.post<{ sha: string }>('/git/blobs', { content: toBase64(file.bytes), encoding: 'base64' })).sha
        : null
      tree.push({ path: file.path, mode: '100644', type: 'blob', sha })
    }
    const newTree = await this.post<{ sha: string }>('/git/trees', { base_tree: base.tree.sha, tree })
    const commit = await this.post<{ sha: string }>('/git/commits', {
      message,
      tree: newTree.sha,
      parents: [baseCommit],
    })

    const update = await this.request(`/git/refs/heads/${this.config.branch}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha, force: false }),
    })
    if (update.status === 422 || update.status === 409) throw new ConflictError()
    if (!update.ok) throw new GitHubError(update.status, 'No se pudo actualizar la rama')
    return commit.sha
  }
}
