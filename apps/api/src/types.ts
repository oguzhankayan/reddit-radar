export type Env = {
  DB: D1Database
  ARTIFACTS: R2Bucket
  CLASSIFY: Queue<ClassifyMessage>
  TYPESAFE_API_KEY: string
  DEEPSEEK_API_KEY: string
}

export type ClassifyMessage =
  | { kind: "stage1"; scanId: string; chunkKey: string }
  | { kind: "finalize"; scanId: string }

export type Account = { id: string; email: string; plan: string; item_quota: number }
