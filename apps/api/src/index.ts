import { Hono } from "hono"
import { authenticate, usedThisMonth } from "./auth.ts"
import type { Env, ClassifyMessage, Account } from "./types.ts"
import { handleBatch } from "./consumer.ts"
import { compileQuery } from "../../../packages/query-compiler/src/compile.ts"
import { LlmMeter } from "../../../packages/llm/src/deepseek.ts"
import { PLANS, type PlanName } from "../../../packages/shared/src/plans.ts"
import { PRESETS } from "../../../packages/classifiers/src/stage2.ts"

/**
 * Reddit Radar API.
 *
 * Bu servis Reddit'e HİÇ dokunmaz (v2 §31). Toplama kullanıcının makinesinde,
 * gerçek bir tarayıcıda koşar — ölçüldü ki tek çalışan yol o. Buranın işi:
 * plan derleme, sınıflandırma, sentez, kullanım ölçümü ve saklama.
 */
type Vars = { account: Account }
const app = new Hono<{ Bindings: Env; Variables: Vars }>()

const SCAN_ID = /^scan_[a-z0-9]{1,32}$/

app.use("/v1/*", async (c, next) => {
  const account = await authenticate(c.env, c.req.header("authorization"))
  if (!account) return c.json({ error: "unauthorized" }, 401)
  c.set("account", account)
  await next()
})

/** Kullanıcının kendi DeepSeek anahtarına ihtiyacı olmasın diye plan burada derlenir. */
app.post("/v1/plan", async (c) => {
  const { question, language } = await c.req.json<{ question?: string; language?: string }>()
  if (!question || question.length < 8) return c.json({ error: "question_too_short" }, 400)
  const meter = new LlmMeter()
  const res = await compileQuery(question, meter, c.env.DEEPSEEK_API_KEY, language)
  if (!res.ok) return c.json({ error: "plan_failed", reason: res.reason }, 502)
  return c.json({ plan: res.plan })
})

app.post("/v1/scans", async (c) => {
  const account = c.get("account")
  const body = await c.req.json<{ question?: string; plan?: unknown; target_items?: number }>()
  if (!body.question || !body.plan) return c.json({ error: "question_and_plan_required" }, 400)

  // Tek tarama sınırı pakete bağlı: free 1.000, diğerleri 20.000.
  const plan = PLANS[(account.plan as PlanName)] ?? PLANS.free
  const asked = body.target_items ?? 5_000
  if (asked > plan.maxScanItems) {
    return c.json({ error: "scan_too_large", max_scan_items: plan.maxScanItems, plan: plan.name }, 400)
  }
  const target = Math.max(100, asked)

  // Rezerve-sonra-harca: başlarken yer olduğundan emin ol ki tarama yarıda kalmasın.
  const used = await usedThisMonth(c.env, account.id)
  if (used + target > account.item_quota) {
    return c.json({
      error: "quota_exceeded", used, quota: account.item_quota,
      remaining: Math.max(0, account.item_quota - used), requested: target,
    }, 402)
  }

  // Preset istemciden geliyor; tanınmayan bir değer Stage 2'de undefined soru
  // setine yol açardı. Bilinmiyorsa reddet.
  const preset = (body.plan as any)?.preset
  if (preset && !PRESETS.includes(preset)) {
    return c.json({ error: "unknown_preset", preset, allowed: PRESETS }, 400)
  }

  const id = `scan_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  await c.env.DB.prepare(
    `INSERT INTO scans (id, account_id, question, spec, status, target_items) VALUES (?,?,?,?,'collecting',?)`,
  ).bind(id, account.id, body.question, JSON.stringify(body.plan), target).run()
  return c.json({ scan_id: id, status: "collecting" })
})

/** Local collector normalize edilmiş item'ları buraya yollar (v2 §26). */
app.post("/v1/scans/:id/items", async (c) => {
  const scan = await loadScan(c.env, c.req.param("id"), c.get("account").id)
  if (!scan) return c.json({ error: "not_found" }, 404)
  if (scan.status !== "collecting") return c.json({ error: "not_collecting", status: scan.status }, 409)

  const { items } = await c.req.json<{ items?: unknown[] }>()
  if (!Array.isArray(items) || !items.length) return c.json({ error: "items_required" }, 400)
  if (items.length > 250) return c.json({ error: "batch_too_large", max: 250 }, 413)

  // Metin R2'de durur ve saklama politikasına tabidir; D1'e girmez.
  const chunkKey = `raw/${scan.id}/${crypto.randomUUID()}.json`
  await c.env.ARTIFACTS.put(chunkKey, JSON.stringify(items), {
    httpMetadata: { contentType: "application/json" },
  })
  await c.env.CLASSIFY.send({ kind: "stage1", scanId: scan.id, chunkKey })
  await c.env.DB.prepare(`UPDATE scans SET received = received + ? WHERE id = ?`)
    .bind(items.length, scan.id).run()

  return c.json({ accepted: items.length, received: scan.received + items.length })
})

app.post("/v1/scans/:id/finalize", async (c) => {
  const scan = await loadScan(c.env, c.req.param("id"), c.get("account").id)
  if (!scan) return c.json({ error: "not_found" }, 404)
  await c.env.DB.prepare(`UPDATE scans SET status = 'classifying' WHERE id = ?`).bind(scan.id).run()
  await c.env.CLASSIFY.send({ kind: "finalize", scanId: scan.id })
  return c.json({ scan_id: scan.id, status: "classifying" })
})

app.get("/v1/scans/:id", async (c) => {
  const scan = await loadScan(c.env, c.req.param("id"), c.get("account").id)
  if (!scan) return c.json({ error: "not_found" }, 404)
  return c.json({
    scan_id: scan.id, status: scan.status, question: scan.question,
    partial_reason: scan.partial_reason ?? undefined,
    progress: { received: scan.received, classified: scan.classified, failures: scan.failures, target: scan.target_items },
  })
})

app.get("/v1/scans/:id/results", async (c) => {
  const scan = await loadScan(c.env, c.req.param("id"), c.get("account").id)
  if (!scan) return c.json({ error: "not_found" }, 404)
  const obj = await c.env.ARTIFACTS.get(`results/${scan.id}.json`)
  if (!obj) return c.json({ error: "not_ready", status: scan.status }, 409)
  const results = await obj.json<any>()
  const limit = Math.min(50, Number(c.req.query("limit") ?? 20))
  return c.json({ ...results, clusters: results.clusters.slice(0, limit) })
})

app.get("/v1/scans/:id/evidence", async (c) => {
  const scan = await loadScan(c.env, c.req.param("id"), c.get("account").id)
  if (!scan) return c.json({ error: "not_found" }, 404)
  const obj = await c.env.ARTIFACTS.get(`results/${scan.id}.json`)
  if (!obj) return c.json({ error: "not_ready", status: scan.status }, 409)
  const results = await obj.json<any>()
  const idx = Number.parseInt(String(c.req.query("cluster_id") ?? "").replace(/^cluster_/, ""), 10)
  const cluster = results.clusters[idx]
  if (!cluster) return c.json({ error: "cluster_not_found", available: results.clusters.length }, 404)
  const limit = Math.min(50, Number(c.req.query("limit") ?? 10))
  return c.json({ cluster_name: cluster.cluster_name, count: cluster.count, evidence: cluster.evidence.slice(0, limit) })
})

/**
 * Prospect listesi — cluster'lardan bağımsız, düz ve filtrelenebilir.
 * "Pazar ne diyor" değil "kime yazılabilir" sorusunun cevabı.
 */
app.get("/v1/scans/:id/prospects", async (c) => {
  const scan = await loadScan(c.env, c.req.param("id"), c.get("account").id)
  if (!scan) return c.json({ error: "not_found" }, 404)
  const obj = await c.env.ARTIFACTS.get(`results/${scan.id}.json`)
  if (!obj) return c.json({ error: "not_ready", status: scan.status }, 409)
  const results = await obj.json<any>()

  const limit = Math.min(200, Number(c.req.query("limit") ?? 50))
  const maxAge = c.req.query("max_age_days") ? Number(c.req.query("max_age_days")) : undefined
  const minOpp = c.req.query("min_opportunity") ? Number(c.req.query("min_opportunity")) : undefined
  const sub = c.req.query("subreddit") ?? undefined

  let rows: any[] = results.prospects ?? []
  const before = rows.length
  if (maxAge !== undefined) rows = rows.filter((r) => r.age_days !== null && r.age_days <= maxAge)
  if (minOpp !== undefined) rows = rows.filter((r) => r.opportunity >= minOpp)
  if (sub) rows = rows.filter((r) => r.subreddit.toLowerCase() === sub.toLowerCase())

  return c.json({
    scan_id: scan.id,
    total_scored: before,
    matched: rows.length,
    filters: { limit, max_age_days: maxAge ?? null, min_opportunity: minOpp ?? null, subreddit: sub ?? null },
    subreddit_breakdown: results.subreddit_breakdown ?? [],
    prospects: rows.slice(0, limit),
  })
})

app.get("/v1/usage", async (c) => {
  const account = c.get("account")
  const used = await usedThisMonth(c.env, account.id)
  const plan = PLANS[(account.plan as PlanName)] ?? PLANS.free
  return c.json({
    plan: account.plan,
    item_quota: account.item_quota,
    used_this_month: used,
    remaining: Math.max(0, account.item_quota - used),
    max_scan_items: plan.maxScanItems,
    unit: "sınıflandırılan item — aylık, takvim ayı başında sıfırlanır",
  })
})

app.get("/health", (c) => c.json({ ok: true }))

async function loadScan(env: Env, id: string, accountId: string) {
  if (!SCAN_ID.test(id)) return null
  return env.DB.prepare(`SELECT * FROM scans WHERE id = ? AND account_id = ?`)
    .bind(id, accountId).first<any>()
}

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<ClassifyMessage>, env: Env): Promise<void> {
    await handleBatch(batch, env)
  },
}
