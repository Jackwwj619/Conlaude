const { execFileSync } = require('node:child_process')
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

function imageEnd(bytes) {
  const pe = bytes.readUInt32LE(0x3c)
  if (bytes.toString('ascii', pe, pe + 4) !== 'PE\0\0') throw new Error('Invalid PE image')
  const count = bytes.readUInt16LE(pe + 6)
  const optionalSize = bytes.readUInt16LE(pe + 20)
  const table = pe + 24 + optionalSize
  let end = bytes.readUInt32LE(pe + 24 + 60)
  for (let index = 0; index < count; index++) {
    const section = table + index * 40
    end = Math.max(end, bytes.readUInt32LE(section + 20) + bytes.readUInt32LE(section + 16))
  }
  if (end > bytes.length) throw new Error('Truncated PE image')
  return end
}

// Windows canonicalizes literal shell property strings without preserving case.
// An indirect RT_STRING resource preserves the product's spelling instead.
module.exports = async (context) => {
  if (process.platform !== 'win32') return
  const files = context.appOutDir
    ? [join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`)]
    : context.artifactPaths.filter((path) => /Conlaude-Portable-.*\.exe$/i.test(path))
  for (const executable of files) {
    const portable = /Conlaude-Portable-.*\.exe$/i.test(executable)
    // NSIS stores its compressed application after the PE sections. Win32's
    // resource writer drops that overlay; restore it byte-for-byte afterwards.
    const original = portable ? readFileSync(executable) : undefined
    const payload = original?.subarray(imageEnd(original))
    execFileSync(
      'powershell.exe',
      ['-NoProfile', '-File', join(__dirname, 'write-shell-name.ps1'), '-Executable', executable],
      { stdio: 'inherit', windowsHide: true }
    )
    if (payload) {
      const updated = readFileSync(executable)
      writeFileSync(executable, Buffer.concat([updated.subarray(0, imageEnd(updated)), payload]))
      const result = readFileSync(executable)
      if (!result.subarray(imageEnd(result)).equals(payload))
        throw new Error('Windows resource update changed the portable payload')
    }
  }
}
