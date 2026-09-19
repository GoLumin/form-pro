import { envValue } from '../env.ts'
import options from 'virtual:form-pro/options'

/**
 * Committing a single file through the GitHub Contents API.
 *
 * No git binary and no checkout, so this works from a Netlify function where
 * the filesystem is read-only and the deployed code is a build artifact. The
 * repository is the source of truth, not the local copy: a deployed build can
 * be several commits behind whatever is on disk beside it.
 *
 * Pushing here triggers a production build, because the site deploys from this
 * branch. The token that allows it is therefore as powerful as write access to
 * the repository — scope it to this one repository, Contents: read and write,
 * and nothing else.
 */

const API = 'https://api.github.com'

export interface GithubConfig {
  token: string
  owner: string
  repo: string
  branch: string
}

/**
 * Null when no token is configured, which is how the UI knows to hide deploy.
 *
 * On a Worker the token only exists if the site handed the integration an `env`
 * module; without one this reads empty and the console correctly offers Save
 * locally alone rather than a deploy button that cannot work.
 */
export function githubConfig(): GithubConfig | null {
  const token = envValue('GITHUB_TOKEN')
  if (!token) return null
  const slug = envValue('GITHUB_REPO') || options.repo
  const [owner, repo] = slug.split('/')
  if (!owner || !repo) return null
  return {
    token,
    owner,
    repo,
    branch: envValue('GITHUB_BRANCH') || options.branch || 'main',
  }
}

function headers(config: GithubConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${config.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  }
}

const toBase64 = (text: string): string =>
  typeof Buffer !== 'undefined'
    ? Buffer.from(text, 'utf8').toString('base64')
    : btoa(String.fromCharCode(...new TextEncoder().encode(text)))

const fromBase64 = (b64: string): string =>
  typeof Buffer !== 'undefined'
    ? Buffer.from(b64, 'base64').toString('utf8')
    : new TextDecoder().decode(
        Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      )

export interface RemoteFile {
  content: string
  /** Blob sha, which the write must echo back so GitHub can reject a stale edit. */
  sha: string
}

export async function getFile(
  config: GithubConfig,
  path: string
): Promise<RemoteFile> {
  const url = `${API}/repos/${config.owner}/${config.repo}/contents/${path}?ref=${encodeURIComponent(config.branch)}`
  const response = await fetch(url, { headers: headers(config) })
  if (!response.ok) {
    throw new Error(
      `GitHub could not read ${path} on ${config.branch} (${response.status}). ` +
        (response.status === 404
          ? 'Check the path is committed and the token can see this repository.'
          : 'Check the token has Contents access to this repository.')
    )
  }
  const body = (await response.json()) as { content?: string; sha?: string }
  if (!body.content || !body.sha) throw new Error(`GitHub returned no content for ${path}`)
  return { content: fromBase64(body.content.replace(/\n/g, '')), sha: body.sha }
}

export interface Commit {
  sha: string
  url: string
  branch: string
}

export interface FileEdit {
  path: string
  content: string
}

/**
 * Commits several files as ONE commit, through the Git Data API.
 *
 * The Contents API can only write a file at a time, and each write is its own
 * commit and therefore its own deploy. The config and the revision log describe
 * the same change, so they land together — one commit, one build, and no window
 * where the history disagrees with the file.
 */
export async function putFiles(
  config: GithubConfig,
  files: FileEdit[],
  message: string
): Promise<Commit> {
  const base = `${API}/repos/${config.owner}/${config.repo}`
  const h = headers(config)

  const call = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`${base}${path}`, { headers: h, ...init })
    if (!response.ok) {
      let detail = `${response.status}`
      try {
        const body = (await response.json()) as { message?: string }
        if (body.message) detail = body.message
      } catch {
        // keep the status
      }
      throw new Error(`GitHub refused ${path} (${detail})`)
    }
    return (await response.json()) as T
  }

  const ref = await call<{ object: { sha: string } }>(
    `/git/ref/heads/${encodeURIComponent(config.branch)}`
  )
  const head = ref.object.sha
  const commit = await call<{ tree: { sha: string } }>(`/git/commits/${head}`)

  const blobs = await Promise.all(
    files.map((file) =>
      call<{ sha: string }>('/git/blobs', {
        method: 'POST',
        body: JSON.stringify({ content: toBase64(file.content), encoding: 'base64' }),
      })
    )
  )

  const tree = await call<{ sha: string }>('/git/trees', {
    method: 'POST',
    body: JSON.stringify({
      base_tree: commit.tree.sha,
      tree: files.map((file, i) => ({
        path: file.path,
        mode: '100644',
        type: 'blob',
        sha: blobs[i].sha,
      })),
    }),
  })

  const created = await call<{ sha: string; html_url: string }>('/git/commits', {
    method: 'POST',
    body: JSON.stringify({ message, tree: tree.sha, parents: [head] }),
  })

  // Not forced: a branch that moved under us should fail, not be overwritten.
  await call(`/git/refs/heads/${encodeURIComponent(config.branch)}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: created.sha, force: false }),
  })

  return { sha: created.sha.slice(0, 7), url: created.html_url, branch: config.branch }
}

export async function putFile(
  config: GithubConfig,
  path: string,
  content: string,
  sha: string,
  message: string
): Promise<Commit> {
  const url = `${API}/repos/${config.owner}/${config.repo}/contents/${path}`
  const response = await fetch(url, {
    method: 'PUT',
    headers: headers(config),
    body: JSON.stringify({
      message,
      content: toBase64(content),
      sha,
      branch: config.branch,
    }),
  })

  if (response.status === 409) {
    throw new Error(
      `${path} changed on ${config.branch} since this page loaded, so nothing was committed. Reload and make the edit again.`
    )
  }
  if (!response.ok) {
    let detail = `${response.status}`
    try {
      const body = (await response.json()) as { message?: string }
      if (body.message) detail = body.message
    } catch {
      // keep the status
    }
    throw new Error(`GitHub refused the commit: ${detail}`)
  }

  const body = (await response.json()) as {
    commit?: { sha?: string; html_url?: string }
  }
  return {
    sha: (body.commit?.sha ?? '').slice(0, 7),
    url: body.commit?.html_url ?? '',
    branch: config.branch,
  }
}
