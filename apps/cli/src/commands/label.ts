import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs"
import { join, basename } from "node:path"
import { createInterface } from "node:readline/promises"
import { stdin, stdout } from "node:process"
import { fromRoot } from "../../../../packages/shared/src/paths.ts"

/**
 * Golden dataset — etiketleme.
 *
 * Neden tabakalı örneklem: precision **shortlist'e alınanlarda** ölçülür.
 * Rastgele 300 postun çoğu zaten elenmiş; onları etiketlemek ölçüme bilgi
 * katmaz, yalnız zaman harcar. Sıralamanın tepesi tam etiketlenir (precision
 * buradan çıkar), altından da bir örneklem alınır (ne kaçırdığımızı görmek için).
 *
 * Yargı senin: soru "bu değerli bir sinyal mi", modelin ne dediği değil.
 * O yüzden skorlar ve Jev/DeepSeek kararları GÖSTERİLMEZ — gördüğün şey postun kendisi.
 */

const LABELS = "tests/golden/labels.json"

type Row = {
  id: string; subreddit: string; title: string; body: string; url: string
  jevPass?: boolean; jevScore?: number; silverPass?: boolean
}
type Label = { label: 0 | 1; title: string; subreddit: string; at: string }

export async function label(opts: { top: number; sample: number; file?: string }): Promise<void> {
  const input = opts.file ?? newestRun()
  const run = JSON.parse(readFileSync(input, "utf8")) as { topic: string; rows: Row[] }
  const rows = run.rows ?? []
  if (!rows.length) return fail(`${input} içinde satır yok`)

  const labels: Record<string, Label> = existsSync(fromRoot(LABELS)) ? JSON.parse(readFileSync(fromRoot(LABELS), "utf8")) : {}

  // Tabakalı: shortlist'in tepesinden hepsi, elenenlerden rastgele örneklem.
  const passed = rows.filter((r) => r.jevPass)
  const rejected = rows.filter((r) => !r.jevPass)
  const top = passed.slice(0, opts.top)
  const sample = shuffle(rejected).slice(0, opts.sample)
  const queue = shuffle([...top, ...sample]).filter((r) => labels[r.id] === undefined)

  console.log(`\n${basename(input)} · ${top.length} tepe + ${sample.length} örneklem · ${queue.length} etiketlenecek`)
  console.log(`(etiketli: ${Object.keys(labels).length})\n`)
  console.log(`ARANAN ŞEY:\n  ${run.topic}\n`)
  console.log(`Soru tek: bu post, yukarıdaki konuda karar vermeye değer gerçek bir sinyal mi?`)
  console.log(`(Sıra karıştırıldı ve skorlar gizlendi — yargın modele göre şekillenmesin.)\n`)

  if (!queue.length) {
    console.log("Etiketlenecek yeni item yok.\n")
    return
  }

  const rl = createInterface({ input: stdin, output: stdout })
  let done = 0

  for (const [i, row] of queue.entries()) {
    console.log(`\n${"─".repeat(78)}`)
    console.log(`[${i + 1}/${queue.length}]  r/${row.subreddit}`)
    console.log(`\n  ${row.title}\n`)
    console.log(`  ${row.body.slice(0, 500).replace(/\n+/g, "\n  ")}\n`)
    console.log(`  ${row.url}\n`)

    const answer = (await rl.question("  [e]vet değerli · [h]ayır · [a]tla · [q] çık : ")).trim().toLowerCase()
    if (answer === "q") break
    if (answer === "a") continue
    labels[row.id] = {
      label: answer === "e" ? 1 : 0,
      title: row.title, subreddit: row.subreddit, at: new Date().toISOString(),
    }
    done++
    writeFileSync(fromRoot(LABELS), JSON.stringify(labels, null, 2)) // her cevaptan sonra: yarım kalmasın
  }

  rl.close()
  const yes = Object.values(labels).filter((l) => l.label === 1).length
  console.log(`\n${done} yeni etiket · toplam ${Object.keys(labels).length} (${yes} evet)`)
  console.log(`${LABELS}\n\nşimdi: node --env-file=.env apps/cli/src/index.ts score\n`)
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j]!, copy[i]!]
  }
  return copy
}

export function newestRun(): string {
  const files = readdirSync(fromRoot("out")).filter((f) => f.startsWith("stage1-")).sort()
  if (!files.length) fail("out/stage1-*.json yok — önce `bench` çalıştır")
  return join(fromRoot("out"), files.at(-1)!)
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}
