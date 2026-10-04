/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 摆渡车批量派车：一条派车任务的录入。 */
export type ShuttleTaskInput = {
  taskName: string
  passengers: number
  route: string
  slot: string
}

/** 批次内的一条派车任务：状态机 待派 → 已派 / 失败，失败必须带一句原因。 */
export type ShuttleDispatchTask = ShuttleTaskInput & {
  seq: number
  state: '待派' | '已派' | '失败'
  vehicleId?: number
  vehicleNo?: string
  reason?: string
}

/** 批量派车批次：cursor 指向下一项要派的任务，断线后从断掉的那一项接着排，整批不回退。 */
export type ShuttleDispatchBatch = {
  id: string
  createdAt: string
  tasks: ShuttleDispatchTask[]
  cursor: number
  done: boolean
}

/** 里程台账：到站结论的唯一一份记录，摆渡车调度与特种车辆维保读的是同一份，不另存副本。 */
export type MileageLedgerEntry = {
  tripId: string
  vehicleId: number
  vehicleNo: string
  taskName: string
  route: string
  slot: string
  mileage: number
  arrivedAt: string
}

export type ShuttleOpsStore = {
  batches: ShuttleDispatchBatch[]
  ledger: MileageLedgerEntry[]
}

export type DispatchRunResult = {
  ok: boolean
  message: string
  batch: ShuttleDispatchBatch
}

export type ArrivalResult = ActionResult & {
  mileage?: number
  tripId?: string
}

export type VehicleMileageSummary = {
  vehicleNo: string
  mileage: number
  trips: number
  lastTripId: string
  lastArrivedAt: string
}
