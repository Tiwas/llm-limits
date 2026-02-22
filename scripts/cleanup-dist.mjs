import fs from 'node:fs'
import path from 'node:path'

const distDir = path.resolve('dist')

if (!fs.existsSync(distDir)) {
  console.log('postdist cleanup: dist/ not found, skipping.')
  process.exit(0)
}

const keepFile = (name) =>
  name.toLowerCase().endsWith('.exe') || name.toLowerCase().endsWith('.exe.blockmap')

const entries = fs.readdirSync(distDir, { withFileTypes: true })
let removedItems = 0

for (const entry of entries) {
  const fullPath = path.join(distDir, entry.name)

  if (entry.isDirectory()) {
    fs.rmSync(fullPath, { recursive: true, force: true })
    removedItems += 1
    continue
  }

  if (!keepFile(entry.name)) {
    fs.rmSync(fullPath, { force: true })
    removedItems += 1
  }
}

console.log(`postdist cleanup: removed ${removedItems} item(s) from dist/.`)
