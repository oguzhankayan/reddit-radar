import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { RADAR_HOME } from "../../../packages/browser/src/browser.ts"

export type ScanStatus =
  | "planning" | "collecting" | "classifying_stage1" | "classifying_stage2"
  | "synthesizing" | "completed" | "partial" | "failed" | "cancelled"

export type ScanState = {
  scan_id: string
  status: ScanStatus
  question: string
  progress: { collected: number; target: number; stage1_matched?: number; stage2_scored?: number; clusters?: number }
  error?: string
  /** API tarafındaki scan kimliği — durum ve sonuç oradan okunur. */
  remoteScanId?: string
  startedAt: string
  finishedAt?: string
}

/**
 * scan_id doğrulaması — MCP girdisi düşman kabul edilir.
 *
 * Bunsuz `scan_id: "../../.."` join() ile RADAR_HOME dışına çıkıyordu ve
 * radar_forget(scope:"all") oradaki her şeyi özyinelemeli siliyordu.
 * Kimlikler bizim ürettiğimiz biçimde: scan_<base36>.
 */
const SCAN_ID = /^scan_[a-z0-9]{1,32}$/

export function isValidScanId(id: string): boolean {
  return SCAN_ID.test(id)
}

const dirOf = (id: string): string => {
  if (!isValidScanId(id)) throw new Error(`geçersiz scan_id: ${String(id).slice(0, 40)}`)
  return join(RADAR_HOME, "scans", id)
}

export function writeState(s: ScanState): void {
  mkdirSync(dirOf(s.scan_id), { recursive: true, mode: 0o700 })
  writeFileSync(join(dirOf(s.scan_id), "state.json"), JSON.stringify(s, null, 2))
}

export function readState(id: string): ScanState | null {
  if (!isValidScanId(id)) return null
  const p = join(dirOf(id), "state.json")
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null
}

export function readResults(id: string): any | null {
  if (!isValidScanId(id)) return null
  const p = join(dirOf(id), "results.json")
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null
}

export function listScans(): ScanState[] {
  const root = join(RADAR_HOME, "scans")
  if (!existsSync(root)) return []
  return readdirSync(root)
    .filter(isValidScanId)
    .map((id) => readState(id))
    .filter((s): s is ScanState => s !== null)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

/**
 * Süreç tarama ortasında ölürse durum dosyası son hâlinde kalır ve
 * radar_scan_status sonsuza kadar "collecting" der. Açılışta bunları
 * yarım olarak işaretliyoruz — kullanıcıya yalan söylemeyelim.
 */
const LIVE: ScanStatus[] = ["planning", "collecting", "classifying_stage1", "classifying_stage2", "synthesizing"]

export function markInterrupted(): number {
  let n = 0
  for (const s of listScans()) {
    if (!LIVE.includes(s.status)) continue
    writeState({ ...s, status: "failed", error: "interrupted: sunucu yeniden başladı", finishedAt: new Date().toISOString() })
    n++
  }
  return n
}

export const scanDir = dirOf
