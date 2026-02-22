import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import os from 'os'

export function findCodexConfigPath(): string | null {
  const homeDir = os.homedir()
  const codexDir = path.join(homeDir, '.codex')
  
  if (fs.existsSync(codexDir)) {
    // Check for common config filenames
    // Prioritize auth.json as it likely contains the OAuth token
    const possibleFiles = ['auth.json', 'config.toml', 'config.json', 'session.json', 'credentials.json']
    
    for (const file of possibleFiles) {
      const fullPath = path.join(codexDir, file)
      if (fs.existsSync(fullPath)) {
        // If we found auth.json, use it. If not, keep looking or use config.toml
        if (file === 'auth.json') return fullPath
        if (file === 'config.toml' && !fs.existsSync(path.join(codexDir, 'auth.json'))) return fullPath
      }
    }
  }
  
  return null
}

export function readCodexToken(): string | null {
  const homeDir = os.homedir()
  const codexDir = path.join(homeDir, '.codex')
  
  // Try auth.json first (most likely for OAuth)
  const authPath = path.join(codexDir, 'auth.json')
  if (fs.existsSync(authPath)) {
      try {
          const content = fs.readFileSync(authPath, 'utf-8')
          const json = JSON.parse(content)
          
          // Direct properties
          if (json.access_token) return json.access_token
          if (json.session_token) return json.session_token
          
          // Nested 'tokens' object (Standard structure for Codex CLI)
          if (json.tokens && json.tokens.access_token) return json.tokens.access_token
          
          // Nested 'default' object (Older/Other CLIs)
          if (json.default && json.default.access_token) return json.default.access_token
      } catch (e) {
          console.error('Error reading auth.json:', e)
      }
  }

  // Fallback to config.toml or other search
  const configPath = findCodexConfigPath()
  if (!configPath || configPath === authPath) return null // Already tried auth.json
  
  try {
    const content = fs.readFileSync(configPath, 'utf-8')
    
    // Handle TOML (Simple Regex Parsing)
    if (configPath.endsWith('.toml')) {
        // Look for: api_key = "sk-..." or access_token = "..."
        // Matches key = "value" or key = 'value'
        const apiKeyMatch = content.match(/api_key\s*=\s*["']([^"']+)["']/)
        if (apiKeyMatch && apiKeyMatch[1]) return apiKeyMatch[1]
        
        const accessTokenMatch = content.match(/access_token\s*=\s*["']([^"']+)["']/)
        if (accessTokenMatch && accessTokenMatch[1]) return accessTokenMatch[1]
        
        return null
    }

    // Handle JSON
    const json = JSON.parse(content)
    
    // Look for common token keys
    if (json.accessToken) return json.accessToken
    if (json.sessionToken) return json.sessionToken
    if (json.apiKey) return json.apiKey
    if (json.token) return json.token
    
    return null
  } catch (e) {
    console.error('Failed to read Codex config:', e)
    return null
  }
}
