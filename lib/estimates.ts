import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function estimateTopicMinutes(
  topics: Array<{ topic_id: string; topic_name: string; domain: number }>
): Promise<Record<string, number>> {
  if (topics.length === 0) return {}

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1500,
    messages: [{
      role: 'user',
      content: `Estimate study minutes for each CompTIA Security+ SY0-701 topic below.

Student profile: CIS degree (cybersecurity concentration), May 2026 graduate. Has basic networking, Linux, cloud, and pen testing lab experience. No prior Security+ study.

Task per topic: read the study guide + understand concepts well enough to pass a scenario-based quiz.

Calibration:
- 10-15 min: tightly scoped single concept (Non-repudiation, Blockchain Technology, Capacity Planning)
- 20-30 min: average topic with a few distinct subtopics (Physical Security, Gap Analysis, Phishing)
- 35-50 min: dense topic with many subtypes, algorithms, or protocols (Encryption Technologies, Firewall Types, Identity and Access Management)

Respond ONLY with valid JSON, no markdown fences:
{"estimates": {"002": 25, "003": 15, ...}}

Topics:
${topics.map((t) => `${t.topic_id} - ${t.topic_name} (Domain ${t.domain})`).join('\n')}`,
    }],
  })

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('')
  const clean = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim()
  const parsed = JSON.parse(clean)
  return parsed.estimates as Record<string, number>
}
