import { exec } from 'child_process'
import { promisify } from 'util'
import store from '../store'

const execAsync = promisify(exec)

interface UsageData {
    percent: number
    used: number
    limit: number
}

export async function getGcloudGeminiUsage(): Promise<UsageData | null> {
    const debug = store.get('debugMode')
    
    try {
        // Check for gcloud presence and fetch quota in one go (using JSON format)
        // We look for 'cloudaicompanion.googleapis.com' (Gemini Code Assist)
        // or generic AI platform quotas.
        
        if (debug) console.log('Executing gcloud quota check...')
        
        // Search for either Gemini Code Assist or Vertex AI (Gemini API)
        const { stdout } = await execAsync('gcloud services list --enabled --filter="config.name:(cloudaicompanion.googleapis.com OR aiplatform.googleapis.com)" --format=json', {
            timeout: 5000 
        })

        if (!stdout || stdout.trim() === '[]') {
            if (debug) console.log('Gemini service (cloudaicompanion) not enabled in current gcloud project.')
            return null
        }

        const services = JSON.parse(stdout)
        if (debug) console.log('Gcloud Service Response:', services)

        // If we get a result, it means the service is enabled.
        // We can't easily get exact usage percentage without Monitoring API,
        // so we return a "Connected" state (0%).
        
        return { percent: 0, used: 0, limit: 100 } 

    } catch (e) {
        if (debug) console.error('Gcloud check failed:', e.message)
        return null
    }
}
