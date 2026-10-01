import { describe, expect, it } from 'vitest'
import { AuthError, ConflictError, GitHubRepo, toBase64 } from '../src/admin/github.ts'

interface Call {
  method: string
  path: string
  body: unknown
  headers: Record<string, string>
}

type Route = (call: Call) => Response | undefined

const API = 'https://api.github.com/repos/grunch/mamata'
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })

function fakeApi(routes: Route[]) {
  const calls: Call[] = []
  const fetchFn = async (url: string, init: RequestInit = {}) => {
    const call: Call = {
      method: init.method ?? 'GET',
      path: url.replace(API, ''),
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      headers: init.headers as Record<string, string>,
    }
    calls.push(call)
    for (const route of routes) {
      const response = route(call)
      if (response) return response
    }
    return new Response('not found', { status: 404 })
  }
  const repo = new GitHubRepo({ owner: 'grunch', repo: 'mamata', branch: 'main', token: 'tkn' }, fetchFn)
  return { repo, calls }
}

const when = (method: string, path: string, respond: (call: Call) => Response): Route => (call) =>
  call.method === method && call.path === path ? respond(call) : undefined

describe('toBase64', () => {
  it('encodes bytes as standard base64', () => {
    expect(toBase64(new Uint8Array([251, 255, 0]))).toBe('+/8A')
  })
})

describe('GitHubRepo', () => {
  it('sends the token and api version on every request', async () => {
    const { repo, calls } = fakeApi([when('GET', '/git/ref/heads/main', () => json({ object: { sha: 'c1' } }))])

    await repo.headCommit()

    expect(calls[0]?.headers.Authorization).toBe('Bearer tkn')
    expect(calls[0]?.headers['X-GitHub-Api-Version']).toBe('2022-11-28')
  })

  it('reads the head commit of the branch', async () => {
    const { repo } = fakeApi([when('GET', '/git/ref/heads/main', () => json({ object: { sha: 'c1' } }))])

    expect(await repo.headCommit()).toBe('c1')
  })

  it('returns null when the branch does not exist yet', async () => {
    const { repo } = fakeApi([])

    expect(await repo.headCommit()).toBeNull()
  })

  it('creates the branch with a first commit when there is no base', async () => {
    const { repo, calls } = fakeApi([
      when('POST', '/git/blobs', () => json({ sha: 'b1' }, 201)),
      when('POST', '/git/trees', () => json({ sha: 't1' }, 201)),
      when('POST', '/git/commits', () => json({ sha: 'c1' }, 201)),
      when('POST', '/git/refs', () => json({ ref: 'refs/heads/main' }, 201)),
    ])

    const sha = await repo.commitFiles(null, [{ path: 'data.enc', bytes: new Uint8Array([1]) }], 'Primera publicación')

    expect(sha).toBe('c1')
    expect(calls.some((c) => c.path.startsWith('/git/commits/'))).toBe(false)
    expect(calls.find((c) => c.path === '/git/trees')?.body).toEqual({
      tree: [{ path: 'data.enc', mode: '100644', type: 'blob', sha: 'b1' }],
    })
    expect(calls.find((c) => c.path === '/git/commits')?.body).toMatchObject({ parents: [] })
    expect(calls.find((c) => c.path === '/git/refs')?.body).toEqual({ ref: 'refs/heads/main', sha: 'c1' })
  })

  it('raises ConflictError when someone else created the branch first', async () => {
    const { repo } = fakeApi([
      when('POST', '/git/blobs', () => json({ sha: 'b1' }, 201)),
      when('POST', '/git/trees', () => json({ sha: 't1' }, 201)),
      when('POST', '/git/commits', () => json({ sha: 'c1' }, 201)),
      when('POST', '/git/refs', () => json({ message: 'Reference already exists' }, 422)),
    ])

    await expect(repo.commitFiles(null, [{ path: 'data.enc', bytes: new Uint8Array([1]) }], 'x')).rejects.toBeInstanceOf(
      ConflictError,
    )
  })

  it('asks GitHub Actions to deploy with a repository dispatch', async () => {
    const { repo, calls } = fakeApi([when('POST', '/dispatches', () => new Response(null, { status: 204 }))])

    await repo.requestDeploy()

    expect(calls[0]?.body).toEqual({ event_type: 'contenido-publicado' })
  })

  it('reports a failed deploy request', async () => {
    const { repo } = fakeApi([when('POST', '/dispatches', () => json({ message: 'nope' }, 422))])

    await expect(repo.requestDeploy()).rejects.toMatchObject({ status: 422 })
  })

  it('reads a raw file at a commit', async () => {
    const { repo, calls } = fakeApi([
      when('GET', '/contents/public/data/data.enc?ref=c1', () => new Response(new Uint8Array([1, 2, 3]))),
    ])

    const bytes = await repo.readFile('public/data/data.enc', 'c1')

    expect(Array.from(bytes ?? [])).toEqual([1, 2, 3])
    expect(calls[0]?.headers.Accept).toBe('application/vnd.github.raw+json')
  })

  it('returns null for a missing file', async () => {
    const { repo } = fakeApi([])

    expect(await repo.readFile('public/data/data.enc', 'c1')).toBeNull()
  })

  it('raises AuthError when the token is rejected', async () => {
    const { repo } = fakeApi([() => new Response('bad', { status: 401 })])

    await expect(repo.headCommit()).rejects.toBeInstanceOf(AuthError)
  })

  it('keeps what GitHub said when it rejects the token', async () => {
    const { repo } = fakeApi([() => json({ message: 'Resource not accessible by personal access token' }, 403)])

    const error = await repo.headCommit().catch((e: unknown) => e)

    expect(error).toMatchObject({ status: 403, detail: 'Resource not accessible by personal access token' })
  })

  it('does not blame the token when GitHub is rate limiting', async () => {
    const { repo } = fakeApi([
      () => new Response('slow down', { status: 403, headers: { 'x-ratelimit-remaining': '0' } }),
    ])

    const error = await repo.headCommit().catch((e: unknown) => e)

    expect(error).not.toBeInstanceOf(AuthError)
    expect(error).toMatchObject({ status: 403 })
  })

  it('commits several files in a single commit', async () => {
    const { repo, calls } = fakeApi([
      when('GET', '/git/commits/c1', () => json({ tree: { sha: 't1' } })),
      when('POST', '/git/blobs', (call) => json({ sha: `blob-${(call.body as { content: string }).content}` }, 201)),
      when('POST', '/git/trees', () => json({ sha: 't2' }, 201)),
      when('POST', '/git/commits', () => json({ sha: 'c2' }, 201)),
      when('PATCH', '/git/refs/heads/main', () => json({ object: { sha: 'c2' } })),
    ])

    const sha = await repo.commitFiles(
      'c1',
      [
        { path: 'public/data/data.enc', bytes: new Uint8Array([1]) },
        { path: 'public/data/img/old.enc', bytes: null },
      ],
      'Publicar cambios',
    )

    expect(sha).toBe('c2')
    const tree = calls.find((c) => c.path === '/git/trees')?.body
    expect(tree).toEqual({
      base_tree: 't1',
      tree: [
        { path: 'public/data/data.enc', mode: '100644', type: 'blob', sha: 'blob-AQ==' },
        { path: 'public/data/img/old.enc', mode: '100644', type: 'blob', sha: null },
      ],
    })
    expect(calls.find((c) => c.path === '/git/commits')?.body).toEqual({
      message: 'Publicar cambios',
      tree: 't2',
      parents: ['c1'],
    })
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ sha: 'c2', force: false })
  })

  it('raises ConflictError when the branch moved meanwhile', async () => {
    const { repo } = fakeApi([
      when('GET', '/git/commits/c1', () => json({ tree: { sha: 't1' } })),
      when('POST', '/git/blobs', () => json({ sha: 'b' }, 201)),
      when('POST', '/git/trees', () => json({ sha: 't2' }, 201)),
      when('POST', '/git/commits', () => json({ sha: 'c2' }, 201)),
      when('PATCH', '/git/refs/heads/main', () => json({ message: 'Update is not a fast forward' }, 422)),
    ])

    await expect(
      repo.commitFiles('c1', [{ path: 'public/data/data.enc', bytes: new Uint8Array([1]) }], 'x'),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('lists file names in a folder', async () => {
    const { repo } = fakeApi([
      when('GET', '/contents/public/data/img?ref=c1', () => json([{ name: 'a.enc', type: 'file' }, { name: 'sub', type: 'dir' }])),
    ])

    expect(await repo.listFiles('public/data/img', 'c1')).toEqual(['a.enc'])
  })

  it('lists nothing for a missing folder', async () => {
    const { repo } = fakeApi([])

    expect(await repo.listFiles('public/data/img', 'c1')).toEqual([])
  })
})
