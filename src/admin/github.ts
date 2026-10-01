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
  constructor(
    status: number,
    // Lo que contestó GitHub (por ejemplo "Bad credentials"), para poder diagnosticar.
    readonly detail: string,
  ) {
    super(status, `GitHub rechazó el token (${status}: ${detail})`)
    this.name = 'AuthError'
  }
}

async function githubMessage(response: Response): Promise<string> {
  try {
    const body = (await response.clone().json()) as { message?: unknown }
    return typeof body.message === 'string' ? body.message : response.statusText
  } catch {
    return response.statusText
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
    if (response.status === 401 || response.status === 403) {
      throw new AuthError(response.status, await githubMessage(response))
    }
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

  // null si la rama todavía no existe (antes de la primera publicación).
  async headCommit(): Promise<string | null> {
    const response = await this.request(`/git/ref/heads/${this.config.branch}`)
    if (response.status === 404) return null
    if (!response.ok) throw new GitHubError(response.status, 'No se pudo leer la rama')
    const ref = (await response.json()) as { object: { sha: string } }
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

  // Un solo commit con todos los archivos. Sin base, crea la rama.
  async commitFiles(baseCommit: string | null, files: FileChange[], message: string): Promise<string> {
    const baseTree = baseCommit ? (await this.json<{ tree: { sha: string } }>(`/git/commits/${baseCommit}`)).tree.sha : null
    const tree = []
    for (const file of files) {
      const sha = file.bytes
        ? (await this.post<{ sha: string }>('/git/blobs', { content: toBase64(file.bytes), encoding: 'base64' })).sha
        : null
      tree.push({ path: file.path, mode: '100644', type: 'blob', sha })
    }
    const newTree = await this.post<{ sha: string }>('/git/trees', baseTree ? { base_tree: baseTree, tree } : { tree })
    const commit = await this.post<{ sha: string }>('/git/commits', {
      message,
      tree: newTree.sha,
      parents: baseCommit ? [baseCommit] : [],
    })

    const update = baseCommit
      ? await this.request(`/git/refs/heads/${this.config.branch}`, {
          method: 'PATCH',
          body: JSON.stringify({ sha: commit.sha, force: false }),
        })
      : await this.request('/git/refs', {
          method: 'POST',
          body: JSON.stringify({ ref: `refs/heads/${this.config.branch}`, sha: commit.sha }),
        })
    if (update.status === 422 || update.status === 409) throw new ConflictError()
    if (!update.ok) throw new GitHubError(update.status, 'No se pudo actualizar la rama')
    return commit.sha
  }

  // Un push a la rama de datos no dispara workflows: se avisa con un repository_dispatch,
  // que corre el workflow de la rama principal (solo necesita "Contents: write").
  async requestDeploy(): Promise<void> {
    const response = await this.request('/dispatches', {
      method: 'POST',
      body: JSON.stringify({ event_type: 'contenido-publicado' }),
    })
    if (!response.ok) throw new GitHubError(response.status, 'GitHub no aceptó el pedido de publicación')
  }
}
