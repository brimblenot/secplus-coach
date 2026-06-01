import fs from 'fs'
import path from 'path'

const TRANSCRIPTS_DIR = path.join(process.cwd(), 'transcripts')

export function getTranscript(topicId: string): string {
  try {
    if (!fs.existsSync(TRANSCRIPTS_DIR)) {
      return `[Transcripts folder not found. Create a /transcripts folder and add the .txt files.]`
    }
    const files = fs.readdirSync(TRANSCRIPTS_DIR)
    const match = files.find((f) => f.startsWith(`${topicId}-`))
    if (!match) {
      return `[Transcript file for topic ${topicId} not found in /transcripts. Add the file named starting with "${topicId}-".]`
    }
    const content = fs.readFileSync(path.join(TRANSCRIPTS_DIR, match), 'utf-8')
    // Cap at 12000 chars to stay within context
    return content.length > 12000
      ? content.slice(0, 12000) + '\n...[transcript continues - truncated for context]'
      : content
  } catch (err) {
    return `[Error reading transcript for topic ${topicId}: ${err}]`
  }
}
