/**
 * Paketler ve kota.
 *
 * Birim (v2 §37): **sınıflandırılan item**. Kullanıcıya token satılmaz.
 * 1 kredi = Stage 1'den geçen 1 item. Stage 2 ve sentez ayrıca ücretlendirilmez —
 * ikisi de shortlist üzerinde çalışır ve hacmi Stage 1'in küçük bir yüzdesidir.
 *
 * Kota **aylık** ve takvim ayı başında sıfırlanır (`start of month`).
 *
 * Rezerve-sonra-harca: `POST /v1/scans` kotayı `target_items` kadar rezerve eder,
 * gerçek tüketim ise sınıflandırılan item sayısıdır. Yani hedefin altında kalan
 * bir tarama kotanın tamamını yakmaz, ama başlarken yer olduğundan emin olunur.
 * Bu bilerek muhafazakâr: yarıda kota biten bir tarama, kullanıcının elinde
 * yarım sonuç bırakırdı.
 */
export type PlanName = "free" | "starter" | "pro" | "agency" | "owner"

export type Plan = {
  name: PlanName
  /** Aylık sınıflandırılabilir item. */
  itemQuota: number
  /** Tek taramada istenebilecek en fazla item. */
  maxScanItems: number
  label: string
}

export const PLANS: Record<PlanName, Plan> = {
  free:    { name: "free",    itemQuota: 1_000,     maxScanItems: 1_000,  label: "Free — 1.000 item/ay, ürünü görmek için" },
  starter: { name: "starter", itemQuota: 100_000,   maxScanItems: 20_000, label: "Starter — 100.000 item/ay" },
  pro:     { name: "pro",     itemQuota: 500_000,   maxScanItems: 20_000, label: "Pro — 500.000 item/ay" },
  agency:  { name: "agency",  itemQuota: 2_000_000, maxScanItems: 20_000, label: "Agency — 2.000.000 item/ay" },
  owner:   { name: "owner",   itemQuota: 5_000_000, maxScanItems: 20_000, label: "Owner — iç kullanım" },
}

export const PLAN_NAMES = Object.keys(PLANS) as PlanName[]

/** ~5.000 item'lık tipik bir taramaya göre kaç tarama demek. */
export function scansPerMonth(plan: Plan, typicalScan = 5_000): number {
  return Math.floor(plan.itemQuota / typicalScan)
}
