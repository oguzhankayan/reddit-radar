import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { decide, pool, Meter, POST_CHARS, DEFAULT_CONCURRENCY } from "../../../../packages/jev/src/client.ts"
import { toDecision } from "../../../../packages/jev/src/decision.ts"
import { stage1Questions, stage1Verdict, shortlist, type ResearchSpec, type Stage1Verdict } from "../../../../packages/classifiers/src/stage1.ts"
import { runStructured, LlmMeter } from "../../../../packages/llm/src/deepseek.ts"
import type { RadarItem } from "../../../../packages/shared/src/types.ts"
import { fence, fenceRule } from "../../../../packages/shared/src/untrusted.ts"
import { fromRoot } from "../../../../packages/shared/src/paths.ts"



type Labeled = {
  item: RadarItem
  jev?: Record<string, { value: boolean; confidence: number }>
  probs?: Record<string, number>
  v1?: Stage1Verdict
  jevPass?: boolean
  jevScore?: number
  silver?: Record<string, boolean>
  silverPass?: boolean
}

/** Alt gruplardan dengeli örneklem — tek subreddit'e yığılmasın. */
function sample(items: RadarItem[], n: number, offset = 0): RadarItem[] {
  const bySub = new Map<string, RadarItem[]>()
  for (const it of items) {
    if (it.body.length < 120) continue // gövdesiz link post'lar etiketlenemez
    const arr = bySub.get(it.subreddit) ?? []
    arr.push(it)
    bySub.set(it.subreddit, arr)
  }
  const subs = [...bySub.keys()].sort()
  const out: RadarItem[] = []
  let i = 0
  while (out.length < n) {
    const sub = subs[i % subs.length]!
    const arr = bySub.get(sub)!
    const idx = Math.floor(i / subs.length) + offset
    if (idx < arr.length) out.push(arr[idx]!)
    i++
    if (i > items.length) break
  }
  return out.slice(0, n)
}

const stateOf = (it: RadarItem) => ({
  subreddit: it.subreddit,
  title: it.title ?? "",
  body: it.body.slice(0, POST_CHARS),
})

const silverSystem = (_TOPIC: string, nonce: string) => `You label Reddit posts for a market-research dataset.

${fenceRule(nonce)}

Answer these five questions about the post and return JSON only:
{"disqualified":bool,"fit":0-4}

disqualified: is the post promoting something the author makes or sells? (being a customer or complaining does NOT count)
fit: how good is this post as evidence for research into "${SPEC.topic}"?
  Researchers want people like: ${SPEC.who.map((x) => "\n  - " + x).join("")}
  Showing signs such as: ${SPEC.pain_signals.map((x) => "\n  - " + x).join("")}
  0 = about something else entirely
  1 = adjacent, but no experience or need of their own
  2 = real first-hand experience, mentioned in passing
  3 = describes their own concrete problem or complaint (long or one line)
  4 = openly deciding: comparing named options, asking what to use, or saying what made them switch`

/**
 * Benchmark spec'i — etiketlediğimiz konunun sayılmış hâli.
 *
 * negative_signals bilerek gözlenen FP'lerden türetildi: kariyer tavsiyesi,
 * listicle/gözlem yazısı, "ben şunu yaptım" postu. Soyut kriterle bunlar
 * %91-96 güvenle geçiyordu.
 */
const SPEC: ResearchSpec = {
  topic: "choosing, paying for, or being frustrated by software tools used to run a business",
  domain: "running or building a software, SaaS, or online business",
  pain_signals: [
    "is comparing two or more specific software products",
    "complains that a tool they use is too expensive or raised its price",
    "is looking for an alternative to a tool they name",
    "describes a tool failing, breaking, or losing their data",
    "is stuck doing something manually because no tool fits",
    "asks which tool or vendor to use for a specific job",
    "complains about a vendor's support, billing, or account handling",
  ],
  who: [
    "a founder or owner running a small software or online business",
    "someone who personally pays for and uses the tools they describe",
    "a small team that outgrew spreadsheets or manual work",
  ],
  // KAPI DAR TUTULUR. Buraya yalnız "ne kadar iyi eşleşirse eşleşsin
  // kullanılamaz" olan şeyler girer. Konu uyuşmazlığı ("araçla ilgili değil",
  // "genel tavsiye") bir DERECE meselesidir ve sıralamanın işidir — kapıya
  // konunca havuzun %96'sı eleniyordu (ölçüldü).
  negative_signals: [
    "is promoting, launching, or marketing something the author built or sells",
    "the author sells or builds tools in this category",
    "is an advertisement, sponsored post, or affiliate promotion",
  ],
}


export async function bench(n: number, TOPIC: string, offset = 0): Promise<void> {
  const raw = readFileSync(fromRoot("tests/fixtures/g1-collect.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as RadarItem)
  const items = sample(raw, n, offset)
  console.log(`\nG2 benchmark — ${items.length} item, konu: "${TOPIC}"\n`)

  const rows: Labeled[] = items.map((item) => ({ item }))
  const jevMeter = new Meter()
  const llmMeter = new LlmMeter()
  const questions = stage1Questions(SPEC)

  // 1. Jev Stage 1
  const t0 = Date.now()
  let done = 0
  await pool(rows, DEFAULT_CONCURRENCY, async (row) => {
    const res = await decide({ purpose: "stage1", state: stateOf(row.item), questions }, jevMeter)
    if (res.ok) {
      const d: Record<string, { value: boolean; confidence: number }> = {}
      const p: Record<string, number> = {}
      for (const [k, a] of Object.entries(res.answers)) {
        const dec = toDecision(a)
        d[k] = { value: dec.value as boolean, confidence: dec.confidence }
        p[k] = a.type === "noul" ? a.noul : dec.confidence
      }
      row.jev = d
      row.probs = p
      row.v1 = stage1Verdict(p)
      row.jevScore = row.v1.score
    }
    if (++done % 50 === 0) process.stdout.write(`  Jev ${done}/${rows.length}\n`)
  })
  const quota = Math.min(500, Math.max(20, Math.round(rows.length * 0.05)))
  for (const r of shortlist(rows, (x) => x.v1, quota)) r.jevPass = true
  for (const r of rows) r.jevPass = r.jevPass ?? false
  const jevMs = Date.now() - t0
  console.log(`  Jev bitti: ${jevMs} ms, ${jevMeter.failed} hata\n`)

  // 2. DeepSeek gümüş etiket
  done = 0
  const t1 = Date.now()
  await pool(rows, 6, async (row) => {
    const f = fence(`subreddit: r/${row.item.subreddit}\ntitle: ${row.item.title ?? ""}\nbody: ${row.item.body.slice(0, POST_CHARS)}`)
    const res = await runStructured<Record<string, boolean>>({
      purpose: "silver",
      system: silverSystem(TOPIC, f.nonce),
      user: `${f.open}\n${f.body}\n${f.close}`,
      maxTokens: 300,
    }, llmMeter)
    if (res.ok) {
      row.silver = res.data
      row.silverPass = (res.data as any).disqualified === false && Number((res.data as any).fit) >= 2
    }
    if (++done % 50 === 0) process.stdout.write(`  DeepSeek ${done}/${rows.length}\n`)
  })
  console.log(`  DeepSeek bitti: ${Date.now() - t1} ms, ${llmMeter.failed} hata\n`)

  // 3. Metrikler
  const usable = rows.filter((r) => r.jev && r.silver)
  const tp = usable.filter((r) => r.jevPass && r.silverPass).length
  const fp = usable.filter((r) => r.jevPass && !r.silverPass).length
  const fn = usable.filter((r) => !r.jevPass && r.silverPass).length
  const tn = usable.filter((r) => !r.jevPass && !r.silverPass).length
  const precision = tp + fp ? tp / (tp + fp) : 0
  const recall = tp + fn ? tp / (tp + fn) : 0

  const ranked = usable.filter((r) => r.jevPass).sort((a, b) => (b.jevScore ?? 0) - (a.jevScore ?? 0))
  const top20 = ranked.slice(0, 20)
  const p20 = top20.length ? top20.filter((r) => r.silverPass).length / top20.length : 0

  // Kriter bazında uyum
  const keys = ["disqualified", "fit"]
  const agree = keys.map((k) => {
    const both = usable.filter((r) => r.jev![k] !== undefined && r.silver![k] !== undefined)
    const same = both.filter((r) => r.jev![k]!.value === r.silver![k]).length
    return { k, pct: both.length ? same / both.length : 0, n: both.length }
  })

  const jevPer1k = (jevMeter.inputTokens / usable.length) * 1_000 * 0.042 / 1e6
  const report = [
    `# G2 — Stage 1 Benchmark`,
    ``,
    `Tarih: ${new Date().toISOString()} · örneklem: ${usable.length} item · konu: "${TOPIC}"`,
    ``,
    `> **Referans gümüş standarttır, insan ground truth DEĞİLDİR.** Etiketler \`deepseek-flash\``,
    `> tarafından bağımsız üretildi. Aşağıdaki precision/recall "Jev ile DeepSeek ne kadar`,
    `> anlaşıyor"u ölçer, "Jev ne kadar doğru"yu değil. Gerçek kapı ölçümü için`,
    `> \`docs/bench-top20-validate.md\` insan tarafından doldurulmalıdır.`,
    ``,
    `## Jev ↔ gümüş etiket karşılaştırması`,
    ``,
    `| metrik | değer |`,
    `|---|---:|`,
    `| precision | ${(precision * 100).toFixed(1)}% |`,
    `| recall | ${(recall * 100).toFixed(1)}% |`,
    `| precision@20 (gümüşe göre) | ${(p20 * 100).toFixed(1)}% |`,
    `| TP / FP / FN / TN | ${tp} / ${fp} / ${fn} / ${tn} |`,
    `| Jev shortlist oranı | ${((ranked.length / usable.length) * 100).toFixed(1)}% |`,
    `| gümüş shortlist oranı | ${((usable.filter((r) => r.silverPass).length / usable.length) * 100).toFixed(1)}% |`,
    ``,
    `## Kriter bazında uyum`,
    ``,
    `| kriter | uyum |`,
    `|---|---:|`,
    ...agree.map((a) => `| ${a.k} | ${(a.pct * 100).toFixed(1)}% |`),
    ``,
    `## Maliyet ve hız`,
    ``,
    `| | Jev | DeepSeek (gümüş) |`,
    `|---|---:|---:|`,
    `| çağrı | ${jevMeter.calls} | ${llmMeter.calls} |`,
    `| hata | ${jevMeter.failed} | ${llmMeter.failed} |`,
    `| girdi token | ${jevMeter.inputTokens} | ${llmMeter.inputTokens} |`,
    `| maliyet | $${jevMeter.usd.toFixed(4)} | $${llmMeter.usd.toFixed(4)} |`,
    `| süre | ${(jevMs / 1000).toFixed(1)} sn | — |`,
    ``,
    `Jev: **$${jevPer1k.toFixed(4)} / 1k item**, ${(jevMeter.inputTokens / usable.length).toFixed(0)} token/item.`,
    `20.000 item Stage 1 → **$${((jevMeter.inputTokens / usable.length) * 20000 * 0.042 / 1e6).toFixed(2)}**, `,
    `${DEFAULT_CONCURRENCY} eşzamanlı ile ~${((jevMs / usable.length) * 20000 / 1000 / 60).toFixed(0)} dk.`,
    ``,
  ].join("\n")
  writeFileSync(fromRoot("docs/bench-stage1.md"), report)

  // 4. Etiketleme için koşu dökümü — `radar label` bunu okur.
  const runPath = fromRoot(`out/stage1-${new Date().toISOString().replace(/[:.]/g, "-")}.json`)
  writeFileSync(runPath, JSON.stringify({
    topic: TOPIC,
    at: new Date().toISOString(),
    rows: usable.map((r) => ({
      id: r.item.id,
      subreddit: r.item.subreddit,
      title: r.item.title ?? "",
      body: r.item.body,
      url: r.item.url,
      createdAt: r.item.createdAt,
      jevPass: r.jevPass,
      jevScore: r.jevScore,
      silverPass: r.silverPass,
      jev: r.jev,
      probs: r.probs,
    })).sort((a, b) => (b.jevScore ?? 0) - (a.jevScore ?? 0)),
  }, null, 2))
  console.log(`Koşu dökümü: ${runPath}`)

  // 5. İnsan doğrulaması için top-20
  const val = [
    `# Top-20 insan doğrulaması (G2 kapısı)`,
    ``,
    `Jev'in en yüksek güvenli 20 shortlist item'ı. Her biri için tek soru:`,
    ``,
    `> Konu **"${TOPIC}"** için bu post gerçekten değerli bir sinyal mi?`,
    ``,
    `\`karar:\` satırına **evet** ya da **hayır** yaz. Kapı: en az **18/20 evet**.`,
    ``,
    `---`,
    ``,
    ...top20.flatMap((r, i) => [
      `## ${i + 1}. r/${r.item.subreddit} — güven ${(r.jevScore ?? 0).toFixed(3)} ${r.silverPass ? "(gümüş: evet)" : "(gümüş: HAYIR)"}`,
      ``,
      `**${r.item.title ?? "(başlıksız)"}**`,
      ``,
      "> " + r.item.body.slice(0, 700).replace(/\n+/g, "\n> "),
      ``,
      `${r.item.url}`,
      ``,
      `karar: `,
      ``,
      `---`,
      ``,
    ]),
  ].join("\n")
  writeFileSync(fromRoot("docs/bench-top20-validate.md"), val)

  console.log(`precision ${(precision * 100).toFixed(1)}% · recall ${(recall * 100).toFixed(1)}% · p@20 ${(p20 * 100).toFixed(1)}% (gümüş)`)
  console.log(`Jev $${jevMeter.usd.toFixed(4)} / DeepSeek $${llmMeter.usd.toFixed(4)}`)
  console.log(`\nRapor: docs/bench-stage1.md`)
  console.log(`Senin doldurman gereken: docs/bench-top20-validate.md\n`)
}
