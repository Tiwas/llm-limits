import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()

const patterns = [
  { name: 'OpenAI key', regex: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'Anthropic key', regex: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'Google API key', regex: /\bAIza[0-9A-Za-z_-]{20,}\b/g },
  { name: 'GitHub token', regex: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { name: 'GitHub PAT', regex: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { name: 'Slack token', regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: 'Private key block', regex: /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/g },
  { name: 'Session cookie value', regex: /\bsessionKey=[A-Za-z0-9._%+-]{10,}\b/g }
]

function getTrackedFiles() {
  const output = execSync('git ls-files', { encoding: 'utf8' })
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function isLikelyText(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096))
  return !sample.includes(0)
}

function findLineNumber(text, index) {
  let line = 1
  for (let i = 0; i < index; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1
  }
  return line
}

function scan() {
  const findings = []
  const files = getTrackedFiles()

  for (const relativePath of files) {
    const absolutePath = path.join(repoRoot, relativePath)
    if (!fs.existsSync(absolutePath)) continue

    const buffer = fs.readFileSync(absolutePath)
    if (!isLikelyText(buffer)) continue

    const content = buffer.toString('utf8')
    for (const pattern of patterns) {
      pattern.regex.lastIndex = 0
      let match = pattern.regex.exec(content)
      while (match) {
        const line = findLineNumber(content, match.index)
        findings.push({
          file: relativePath,
          line,
          type: pattern.name,
          preview: match[0].slice(0, 80)
        })
        match = pattern.regex.exec(content)
      }
    }
  }

  return findings
}

const findings = scan()
if (findings.length > 0) {
  console.error('Secret scan failed. Potential secrets found:')
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} [${finding.type}] ${finding.preview}`)
  }
  process.exit(1)
}

console.log('Secret scan passed: no known secret patterns found in tracked files.')
