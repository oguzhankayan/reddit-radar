import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { createInterface } from "node:readline/promises"
import { stdin, stdout } from "node:process"
import { homedir } from "node:os"
import { fromRoot } from "../../../../packages/shared/src/paths.ts"

/**
 * G3 kapısı (v2 §65): uçtan uca taramanın top 20 evidence'ının en az 18'i
 * elle bakıldığında gerçekten değerli olmalı.
 *
 * `label` gibi: skorlar gizli, sıra karışık, her cevapta kaydeder.
 * Yargı senin; modelin ne dediği görünmüyor.
 */
const HOME = process.env.RADAR_HOME ?? join(homedir(), ".reddit-radar")

export async function gate(scanId: string | undefined, n: number): Promise<void> {
  const root = join(HOME, "scans")
  const id = scanId ?? readdirSync(root).filter((d) => existsSync(join(root, d, "results.json"))).sort().at(-1)
  if (!id) return void console.error("Sonuçlanmış tarama yok.")

  const dir = join(root, id)
  const r = JSON.parse(readFileSync(join(dir, "results.json"), "utf8"))
  const labelPath = join(dir, "gate-labels.json")
  const labels: Record<string, { label: 0 | 1; cluster: string; url: string }> =
    existsSync(labelPath) ? JSON.parse(readFileSync(labelPath, "utf8")) : {}

  type Ev = { reddit_url: string; subreddit: string; title?: string; excerpt: string; opportunity: number; cluster: string }

  // Cluster'lardan evidence'ı skora göre düzleştir.
  const all: Ev[] = r.clusters
    .flatMap((c: any) => (c.evidence as any[]).map((e): Ev => ({ ...e, cluster: c.cluster_name })))
    .sort((a: Ev, b: Ev) => b.opportunity - a.opportunity)
    .slice(0, n)
  const queue = shuffle(all).filter((e) => labels[e.reddit_url] === undefined)

  console.log(`\nG3 kapısı · ${id}`)
  console.log(`Soru: ${r.question}`)
  console.log(`\nTop ${all.length} evidence · ${queue.length} değerlendirilecek · (etiketli: ${Object.keys(labels).length})`)
  console.log(`\nSoru tek: bu post, yukarıdaki araştırma sorusu için karar vermeye değer gerçek bir sinyal mi?`)
  console.log(`Kapı: en az ${Math.ceil(all.length * 0.9)}/${all.length} evet.`)
  console.log(`(Skorlar gizli, sıra karışık — yargın modele göre şekillenmesin.)\n`)

  if (queue.length) {
    const rl = createInterface({ input: stdin, output: stdout })
    for (const [i, e] of queue.entries()) {
      console.log(`\n${"─".repeat(78)}`)
      console.log(`[${i + 1}/${queue.length}]  r/${e.subreddit}\n`)
      console.log(`  ${e.title ?? "(başlıksız)"}\n`)
      console.log(`  ${String(e.excerpt).slice(0, 450).replace(/\n+/g, "\n  ")}\n`)
      console.log(`  ${e.reddit_url}\n`)
      const a = (await rl.question("  [e]vet değerli · [h]ayır · [a]tla · [q] çık : ")).trim().toLowerCase()
      if (a === "q") break
      if (a === "a") continue
      labels[e.reddit_url] = { label: a === "e" ? 1 : 0, cluster: e.cluster, url: e.reddit_url }
      writeFileSync(labelPath, JSON.stringify(labels, null, 2))
    }
    rl.close()
  }

  const done = all.filter((e) => labels[e.reddit_url] !== undefined)
  const yes = done.filter((e) => labels[e.reddit_url]!.label === 1).length
  const need = Math.ceil(all.length * 0.9)
  const pass = done.length >= all.length && yes >= need

  const report = [
    `# G3 kapı ölçümü — uçtan uca tarama`,
    ``,
    `Tarih: ${new Date().toISOString()} · tarama: \`${id}\``,
    `Soru: ${r.question}`,
    ``,
    `| kriter | hedef | ölçülen | |`,
    `|---|---|---:|---|`,
    `| top-${all.length} evidence değerli | ≥ ${need} | ${yes}/${done.length} | ${pass ? "✅" : done.length < all.length ? "⚠️ eksik etiket" : "❌"} |`,
    ``,
    `**Sonuç: ${pass ? "✅ GEÇTİ" : "❌ GEÇMEDİ"}**`,
    ``,
    `## Coverage`,
    ``,
    "```json",
    JSON.stringify(r.coverage, null, 1),
    "```",
    ``,
    `## Değersiz bulunanlar`,
    ``,
    ...(done.filter((e) => labels[e.reddit_url]!.label === 0).map((e) => `- [${e.cluster}] ${e.title} — ${e.reddit_url}`)),
    ``,
  ].join("\n")
  writeFileSync(fromRoot("docs/gate-g3.md"), report)
  console.log(`\n${yes}/${done.length} değerli (kapı: ${need}/${all.length})`)
  console.log(`${pass ? "✅ KAPI GEÇTİ" : done.length < all.length ? "⚠️ etiketleme yarım" : "❌ kapı geçmedi"}  →  docs/gate-g3.md\n`)
}

function shuffle<T>(a: T[]): T[] {
  const c = [...a]
  for (let i = c.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [c[i], c[j]] = [c[j]!, c[i]!] }
  return c
}
