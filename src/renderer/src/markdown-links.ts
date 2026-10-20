export function isWebLink(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol)
  } catch {
    return false
  }
}

export function isFileReference(url: string): boolean {
  if (
    !url ||
    [...url].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
    url.startsWith('//') ||
    url.startsWith('\\\\')
  )
    return false
  if (/^[a-z]:[\\/]/i.test(url)) return true
  if (/^[^\s:?#]+\.[a-z\d]+:\d+(?::\d+)?(?:#L\d+)?$/i.test(url)) return true
  if (/^[a-z][a-z\d+.-]*:/i.test(url)) return false
  return (
    /^(?:\/|\.{1,2}\/|~\/)/.test(url) ||
    /^[^\s:?#]+(?:\/[^?#]+|\.[a-z\d]+)(?::\d+(?::\d+)?)?(?:#L\d+(?:C\d+)?)?$/i.test(url)
  )
}

export function markdownUrl(url: string): string {
  if (isWebLink(url) || isFileReference(url)) return url
  if (
    url.length <= 2_000_000 &&
    /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z\d+/=]+$/i.test(url)
  )
    return url
  return ''
}

/** Conservative display heuristic; paths alone cannot establish remote filesystem type. */
export function fileLinkDetails(
  reference: string
): { path: string; name: string; line?: string } | undefined {
  let decoded: string
  try {
    decoded = decodeURIComponent(reference)
  } catch {
    return undefined
  }
  if (!isFileReference(decoded)) return undefined
  const lineMatch = decoded.match(/(?:#L|:)(\d+)(?:(?:C|:)\d+)?$/i)
  const path = lineMatch ? decoded.slice(0, lineMatch.index) : decoded
  const name = path.split(/[\\/]/).pop() || ''
  if (!name || name === '.' || name === '..') return undefined
  const extension = /[^.]\.[a-z\d]{1,16}$/i.test(name)
  const special =
    /^(?:README|LICENSE|LICENCE|COPYING|NOTICE|Makefile|Dockerfile|Containerfile|Gemfile|Rakefile|Procfile|Jenkinsfile|\.env(?:\..+)?|\.gitignore|\.gitattributes|\.editorconfig|\.npmrc)$/i.test(
      name
    )
  if (!extension && !special) return undefined
  return { path, name, line: lineMatch?.[1] }
}
