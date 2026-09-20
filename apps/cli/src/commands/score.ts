import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { newestRun } from "./label.ts"
import { fromRoot } from "../../../../packages/shared/src/paths.ts"

const LABELS = "tests/golden/labels.json"

type Row = { id: string; jevPass?: boolean; jevScore?: number; silverPass?: boolean }
type Label = { label: 0 | 1 }

export function score(file?: string): void {
  const input = file ?? newestRun()
  const run = JSON.parse(readFileSync(input, "utf8")) as { topic: string; rows: Row[] }
  if (!existsSync(fromRoot(LABELS))) {
    console.error(`${LABELS} yok — önce \`label\` çalıştır`)
    process.exit(1)
  }
  const labels = JSON.parse(readFileSync(fromRoot(LABELS), "utf8")) as Record<string, Label>

  const labeled = run.rows.filter((r) => labels[r.id] !== undefined)
  const truth = (r: Row) => labels[r.id]!.label === 1

  const passed = labeled.filter((r) => r.jevPass)
  const rejected = labeled.filter((r) => !r.jevPass)

  const tp = passed.filter(truth).length
  const fp = passed.length - tp
  const precision = passed.length ? tp / passed.length : 0

  // Elenenlerden alınan örneklemdeki pozitif oranı → kaçırılanların tahmini.
  const sampleFn = rejected.filter(truth).length
  const missRate = rejected.length ? sampleFn / rejected.length : 0
  const totalRejected = run.rows.filter((r) => !r.jevPass).length
  const estFn = Math.round(missRate * totalRejected)
  const totalPassed = run.rows.filter((r) => r.jevPass).length
  const estTp = Math.round(precision * totalPassed)
  const estRecall = estTp + estFn ? estTp / (estTp + estFn) : 0

  const ranked = run.rows.filter((r) => r.jevPass).sort((a, b) => (b.jevScore ?? 0) - (a.jevScore ?? 0))
  const atK = (k: number) => {
    const slice = ranked.slice(0, k).filter((r) => labels[r.id] !== undefined)
    return { n: slice.length, hits: slice.filter(truth).length, pct: slice.length ? slice.filter(truth).length / slice.length : 0 }
  }
  const p10 = atK(10)
  const p20 = atK(20)

  // Jev vs gümüş: hangisi insana daha yakın?
  const jevAgree = labeled.filter((r) => (r.jevPass ?? false) === truth(r)).length / (labeled.length || 1)
  const silverLabeled = labeled.filter((r) => r.silverPass !== undefined)
  const silverAgree = silverLabeled.length
    ? silverLabeled.filter((r) => (r.silverPass ?? false) === truth(r)).length / silverLabeled.length
    : 0

  const gateP20 = p20.pct >= 0.9 && p20.n >= 20
  const gateOverall = precision >= 0.85
  const pass = gateP20 && gateOverall

  const pct = (v: number) => `${(v * 100).toFixed(1)}%`
  const report = [
    `# G2 kapı ölçümü — insan etiketli`,
    ``,
    `Tarih: ${new Date().toISOString()} · koşu: \`${input}\` · konu: "${run.topic}"`,
    `Etiketli item: **${labeled.length}** (${passed.length} shortlist + ${rejected.length} elenen örneklem)`,
    ``,
    `## Kapı`,
    ``,
    `| kriter | hedef | ölçülen | |`,
    `|---|---|---:|---|`,
    `| precision@20 | ≥ 90% | ${pct(p20.pct)} (${p20.hits}/${p20.n}) | ${gateP20 ? "✅" : p20.n < 20 ? "⚠️ yetersiz etiket" : "❌"} |`,
    `| overall precision | ≥ 85% | ${pct(precision)} (${tp}/${passed.length}) | ${gateOverall ? "✅" : "❌"} |`,
    ``,
    `**Sonuç: ${pass ? "✅ GEÇTİ" : "❌ GEÇMEDİ"}**`,
    ``,
    `## Ayrıntı`,
    ``,
    `| metrik | değer |`,
    `|---|---:|`,
    `| precision@10 | ${pct(p10.pct)} (${p10.hits}/${p10.n}) |`,
    `| precision@20 | ${pct(p20.pct)} (${p20.hits}/${p20.n}) |`,
    `| TP / FP (shortlist) | ${tp} / ${fp} |`,
    `| elenen örneklemde kaçan | ${sampleFn}/${rejected.length} (${pct(missRate)}) |`,
    `| tahmini recall | ${pct(estRecall)} |`,
    ``,
    `> Recall bir **tahmindir**: elenen ${totalRejected} item'ın ${rejected.length}'i etiketlendi,`,
    `> oradaki pozitif oranı tüm elenenlere yansıtıldı.`,
    ``,
    `## Kim insana daha yakın?`,
    ``,
    `| | insanla uyum |`,
    `|---|---:|`,
    `| Jev shortlist | ${pct(jevAgree)} |`,
    `| DeepSeek gümüş | ${pct(silverAgree)} |`,
    ``,
    pass
      ? `Stage 1 rubric'i kalibre. G3'e geçilebilir.`
      : `Kapı tutmadı → rubric yeniden yazılır, eşik kalibre edilir, yeniden ölçülür (v2 §55).`,
    ``,
  ].join("\n")

  writeFileSync(fromRoot("docs/bench-gate.md"), report)
  console.log(`\nprecision@20 ${pct(p20.pct)} (${p20.hits}/${p20.n}) · overall ${pct(precision)} (${tp}/${passed.length})`)
  console.log(`tahmini recall ${pct(estRecall)} · insanla uyum: Jev ${pct(jevAgree)} / DeepSeek ${pct(silverAgree)}`)
  console.log(`\n${pass ? "✅ KAPI GEÇTİ" : "❌ kapı geçmedi"}  →  docs/bench-gate.md\n`)
}
