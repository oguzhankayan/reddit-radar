import { z } from "zod"
import { runStructured, type LlmMeter } from "./deepseek.ts"
import { fence, fenceRule, sanitizeUntrusted } from "../../shared/src/untrusted.ts"

/**
 * Cluster + synthesis (v2 §44).
 *
 * Vector DB yok, embedding yok. Shortlist chunk'lar hâlinde DeepSeek'e gider,
 * sonra deterministic merge.
 *
 * GÜVENLİK: evidence metni nonce'lu UNTRUSTED sınırıyla çevrelenir ve yalnız
 * `user` mesajında taşınır — asla system prompt'a girmez (v2 §25). Sabit etiket
 * yetmez: post metnine kapanış etiketi yazarak bloktan kaçılabilirdi.
 */
export const ClusterSchema = z.object({
  clusters: z.array(z.object({
    cluster_name: z.string().min(3).max(140),
    member_ids: z.array(z.string()).min(1),
    summary: z.string().min(10).max(1200),
    common_pattern: z.string().min(5).max(800),
  })).max(20),
})
export type Clusters = z.infer<typeof ClusterSchema>

const systemFor = (nonce: string) => `You group Reddit posts into thematic clusters for a market-research report.

${fenceRule(nonce)}

Return JSON only:
{"clusters":[{"cluster_name":"...","member_ids":["..."],"summary":"...","common_pattern":"..."}]}

cluster_name: the specific complaint or need, as a claim ("Klaviyo pricing breaks down for small lists").
member_ids: only ids that appear in the input.
common_pattern: what these authors have in common.
Produce at most 8 clusters per chunk. Every post must go into at most one cluster. Leave out posts that fit nowhere.`

export type ClusterInput = { id: string; subreddit: string; title: string; excerpt: string }

export async function clusterChunk(
  items: ClusterInput[],
  topic: string,
  meter?: LlmMeter,
  apiKey?: string,
): Promise<{ ok: true; clusters: Clusters["clusters"] } | { ok: false; reason: string }> {
  const raw = items
    .map((i) => `id: ${i.id}\nr/${sanitizeUntrusted(i.subreddit)} — ${i.title}\n${i.excerpt.slice(0, 500)}`)
    .join("\n---\n")
  const f = fence(raw)

  const res = await runStructured<unknown>({
    purpose: "cluster",
    system: systemFor(f.nonce),
    user: `Research topic: ${sanitizeUntrusted(topic)}\n\n${f.open}\n${f.body}\n${f.close}`,
    maxTokens: 6_000,
    apiKey,
  }, meter)
  if (!res.ok) return { ok: false, reason: `${res.reason}${res.detail ? `: ${res.detail.slice(0, 120)}` : ""}` }

  const parsed = ClusterSchema.safeParse(res.data)
  if (!parsed.success) {
    // Sebebi görünür olsun: "invalid_clusters" tek başına teşhis ettirmiyordu.
    return { ok: false, reason: `invalid_clusters: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`.slice(0, 160) }
  }

  // Model uydurmuş olabilir: girdi setinde olmayan id'leri at.
  const known = new Set(items.map((i) => i.id))
  const clusters = parsed.data.clusters
    .map((c) => ({ ...c, member_ids: c.member_ids.filter((id) => known.has(id)) }))
    .filter((c) => c.member_ids.length > 0)
  return { ok: true, clusters }
}

/** Chunk'lardan gelen kümeleri isim benzerliğine göre deterministic birleştirir. */
export function mergeClusters(all: Clusters["clusters"]): Clusters["clusters"] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter(Boolean)
  const out: (Clusters["clusters"][number] & { _tokens: Set<string> })[] = []

  for (const c of all) {
    const tokens = new Set(norm(c.cluster_name))
    const hit = out.find((o) => jaccard(o._tokens, tokens) >= 0.5)
    if (hit) {
      hit.member_ids = [...new Set([...hit.member_ids, ...c.member_ids])]
    } else {
      out.push({ ...c, _tokens: tokens })
    }
  }
  return out
    .map(({ _tokens, ...c }) => c)
    .sort((a, b) => b.member_ids.length - a.member_ids.length)
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  return inter / (a.size + b.size - inter)
}
