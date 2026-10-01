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
