import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, loadShuttleOps, resetRows, saveRows, saveShuttleOps } from '@/data/local-store'
import type {
  ActionResult,
  ArrivalResult,
  DispatchRunResult,
  EntryRow,
  MileageLedgerEntry,
  ModuleMeta,
  OverviewResult,
  PageResult,
  ShuttleDispatchBatch,
  ShuttleDispatchTask,
  ShuttleTaskInput,
  VehicleMileageSummary,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 状态机守卫：登记了守卫的模块，动作只允许从列出的源状态发起。
// 摆渡车的作业环是 待命 → 执行中 → 待命，跳步的一律挡回。
const STATUS_FLOW_GUARDS: Record<string, Record<string, string[]>> = {
  shuttle: {
    派发任务: ['待命'],
    确认到站: ['执行中'],
    申请维保: ['待命'],
  },
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  const flowGuard = STATUS_FLOW_GUARDS[key]?.[action]
  if (flowGuard && !flowGuard.includes(current)) {
    return {
      ok: false,
      message: `${meta.entity}当前状态「${current}」，不能执行「${action}」：状态须按待命、执行中、待命顺次推进，跳步一律挡回`,
    }
  }
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  // 行内若有「××状态」展示字段，跟着真实状态一起更新，页面上不出现两份说法。
  const statusField = meta.fields.find((field) => field.endsWith('状态'))
  if (statusField && statusField in updated) {
    updated[statusField] = target
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}

// —— 摆渡车调度：按核载与路线的排班层 ——

const SHUTTLE_KEY = 'shuttle'

export type ShuttleDispatchOptions = {
  /** 联调演示用：本批第几次派车时模拟车载终端断线；0 或缺省表示不断线。 */
  breakAt?: number
}

export type ShuttleArrivalOptions = {
  /** 联调演示用：模拟车载终端断线，本次里程读数采集失败。 */
  simulateOutage?: boolean
}

function nowText(): string {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

function capacityOf(vehicle: EntryRow): number {
  const value = Number(vehicle['核载人数'])
  return Number.isFinite(value) && value > 0 ? value : 0
}

function tripIdOf(batchId: string, seq: number): string {
  return `TRIP-${batchId}-${seq}`
}

function emptyBatch(): ShuttleDispatchBatch {
  return { id: '', createdAt: '', tasks: [], cursor: 0, done: true }
}

function persistBatch(batch: ShuttleDispatchBatch): void {
  const ops = loadShuttleOps()
  const index = ops.batches.findIndex((item) => item.id === batch.id)
  const batches = [...ops.batches]
  if (index >= 0) {
    batches[index] = batch
  } else {
    batches.push(batch)
  }
  saveShuttleOps({ ...ops, batches })
}

type TaskPlan = { ok: true; vehicle: EntryRow } | { ok: false; reason: string }

// 给一条任务挑车：先看路线时段有没有被占，再看有没有待命车，最后核载不够的一律拒绝。
function planShuttleTask(task: ShuttleTaskInput, vehicles: EntryRow[]): TaskPlan {
  const routeBusy = vehicles.some(
    (vehicle) =>
      String(vehicle.status) === '执行中' &&
      String(vehicle['行驶路线'] ?? '') === task.route &&
      String(vehicle['发车时间'] ?? '') === task.slot,
  )
  if (routeBusy) {
    return {
      ok: false,
      reason: `路线「${task.route}」在 ${task.slot} 时段已有车辆执行中：一条路线同一时段只允许一辆车`,
    }
  }
  const idle = vehicles.filter((vehicle) => String(vehicle.status) === '待命')
  if (idle.length === 0) {
    return { ok: false, reason: '没有待命车辆可派：在册车辆均在执行、充电或维保中' }
  }
  const fit = idle.filter((vehicle) => capacityOf(vehicle) >= task.passengers)
  if (fit.length === 0) {
    const max = Math.max(...idle.map(capacityOf))
    return {
      ok: false,
      reason: `超出核载：任务 ${task.passengers} 人，待命车辆最大核载 ${max} 人，超出核载一律拒绝`,
    }
  }
  // 够坐的车里挑核载最小的，大车留给大任务；同核载按编号顺序，结果可预期。
  fit.sort((a, b) => capacityOf(a) - capacityOf(b) || Number(a.id) - Number(b.id))
  return { ok: true, vehicle: fit[0] }
}

function runShuttleBatch(batch: ShuttleDispatchBatch, options: ShuttleDispatchOptions): DispatchRunResult {
  const vehicles = listRows(SHUTTLE_KEY).map((row) => ({ ...row }))
  let attempts = 0
  for (let i = batch.cursor; i < batch.tasks.length; i += 1) {
    const task = batch.tasks[i]
    if (task.state === '已派') {
      batch.cursor = i + 1
      continue
    }
    attempts += 1
    if (options.breakAt && attempts === options.breakAt) {
      // 模拟断线：本项没派出去，游标停在断掉的那一项，已派的保留不回退。
      task.state = '失败'
      task.reason = '派车中断：车载终端断线，本项未派出，恢复后从本项接着排'
      batch.cursor = i
      persistBatch(batch)
      const dispatched = batch.tasks.filter((item) => item.state === '已派').length
      return {
        ok: false,
        message: `第 ${i + 1} 项「${task.taskName}」派车时断线：已派 ${dispatched} 项保留不回退，恢复后点「继续派车」从断点接着排`,
        batch,
      }
    }
    const plan = planShuttleTask(task, vehicles)
    if (!plan.ok) {
      task.state = '失败'
      task.reason = plan.reason
      batch.cursor = i + 1
      continue
    }
    const vehicle = plan.vehicle
    vehicle.status = '执行中'
    vehicle.pending = true
    vehicle.abnormal = false
    vehicle['当前任务'] = task.taskName
    vehicle['行驶路线'] = task.route
    vehicle['发车时间'] = task.slot
    vehicle['车辆状态'] = '执行中'
    vehicle['当前趟次'] = tripIdOf(batch.id, task.seq)
    // 每派出一辆立即落库：中途断线也不把整批派车退回。
    saveRows(SHUTTLE_KEY, vehicles)
    task.state = '已派'
    task.vehicleId = Number(vehicle.id)
    task.vehicleNo = String(vehicle['车辆编号'] ?? '')
    delete task.reason
    batch.cursor = i + 1
    persistBatch(batch)
  }
  batch.done = batch.tasks.every((task) => task.state !== '待派')
  persistBatch(batch)
  const dispatched = batch.tasks.filter((task) => task.state === '已派').length
  const failed = batch.tasks.filter((task) => task.state === '失败').length
  const message =
    failed === 0
      ? `本批 ${batch.tasks.length} 项任务全部派出`
      : `已派 ${dispatched} 项，${failed} 项派不出去，原因见明细`
  return { ok: failed === 0, message, batch }
}

export function startShuttleDispatch(
  inputs: ShuttleTaskInput[],
  options: ShuttleDispatchOptions = {},
): DispatchRunResult {
  const tasks: ShuttleDispatchTask[] = inputs.map((input, index) => ({
    seq: index + 1,
    taskName: input.taskName.trim(),
    passengers: Number(input.passengers),
    route: input.route.trim(),
    slot: input.slot.trim(),
    state: '待派',
  }))
  if (tasks.length === 0) {
    return { ok: false, message: '请先添加要派的任务', batch: emptyBatch() }
  }
  const invalid = tasks.find(
    (task) => !task.taskName || !task.route || !task.slot || !Number.isFinite(task.passengers) || task.passengers < 1,
  )
  if (invalid) {
    return {
      ok: false,
      message: `第 ${invalid.seq} 项任务信息不完整：任务名称、乘车人数（≥1）、行驶路线、发车时段都要填`,
      batch: emptyBatch(),
    }
  }
  const batch: ShuttleDispatchBatch = {
    id: `PB${Date.now().toString(36).toUpperCase()}`,
    createdAt: nowText(),
    tasks,
    cursor: 0,
    done: false,
  }
  return runShuttleBatch(batch, options)
}

export function resumeShuttleDispatch(
  batchId: string,
  options: ShuttleDispatchOptions = {},
): DispatchRunResult {
  const batch = loadShuttleOps().batches.find((item) => item.id === batchId)
  if (!batch) {
    return { ok: false, message: '没有找到要续派的批次', batch: emptyBatch() }
  }
  if (batch.done) {
    return { ok: true, message: '本批次已办结，没有待派任务', batch }
  }
  return runShuttleBatch(batch, options)
}

export function latestShuttleBatch(): ShuttleDispatchBatch | null {
  const batches = loadShuttleOps().batches
  return batches.length > 0 ? batches[batches.length - 1] : null
}

// 采集里程读数：上一程读数加本趟行驶里程。同一趟次重采结果一致，失败时不回写、不拿旧值顶替。
function collectMileage(vehicle: EntryRow, tripId: string): number {
  const previous = Number(vehicle['里程读数'])
  const base = Number.isFinite(previous) && previous >= 0 ? previous : 0
  let hash = 0
  for (const ch of tripId) {
    hash = (hash * 31 + ch.charCodeAt(0)) % 997
  }
  return base + 5 + (hash % 20)
}

function completeShuttleTrip(vehicles: EntryRow[], vehicle: EntryRow, mileage: number): void {
  vehicle.status = '待命'
  vehicle.pending = false
  vehicle.abnormal = false
  vehicle['里程读数'] = mileage
  vehicle['当前任务'] = ''
  vehicle['行驶路线'] = ''
  vehicle['发车时间'] = ''
  vehicle['车辆状态'] = '待命'
  vehicle['当前趟次'] = ''
  saveRows(SHUTTLE_KEY, vehicles)
}

export function confirmShuttleArrival(
  vehicleId: number,
  options: ShuttleArrivalOptions = {},
): ArrivalResult {
  const vehicles = listRows(SHUTTLE_KEY).map((row) => ({ ...row }))
  const vehicle = vehicles.find((row) => Number(row.id) === vehicleId)
  if (!vehicle) {
    return { ok: false, message: `没有找到编号为 ${vehicleId} 的摆渡车` }
  }
  const current = String(vehicle.status)
  if (current !== '执行中') {
    return {
      ok: false,
      message: `摆渡车当前状态「${current}」，不能确认到站：状态须按待命、执行中、待命顺次推进，跳步一律挡回`,
    }
  }
  const tripId = String(vehicle['当前趟次'] ?? '') || `TRIP-LEGACY-${vehicleId}`
  if (options.simulateOutage) {
    // 取不到读数按失败处理：车辆保持执行中，不拿上一次旧值顶替，允许恢复后再取一次。
    return {
      ok: false,
      message: `里程读数采集失败（车载终端断线）：本次到站未入账，不会拿上一次读数顶替，请恢复后重新确认到站`,
      tripId,
    }
  }
  const ops = loadShuttleOps()
  const existing = ops.ledger.find((entry) => entry.tripId === tripId)
  if (existing) {
    // 同一趟到站重复提交：台账里已有这一趟，只记一次里程，不再写第二份。
    completeShuttleTrip(vehicles, vehicle, existing.mileage)
    return {
      ok: true,
      message: `趟次 ${tripId} 的里程 ${existing.mileage} 已入账，重复提交只记一次，不再记账`,
      mileage: existing.mileage,
      tripId,
    }
  }
  const mileage = collectMileage(vehicle, tripId)
  const entry: MileageLedgerEntry = {
    tripId,
    vehicleId,
    vehicleNo: String(vehicle['车辆编号'] ?? ''),
    taskName: String(vehicle['当前任务'] ?? ''),
    route: String(vehicle['行驶路线'] ?? ''),
    slot: String(vehicle['发车时间'] ?? ''),
    mileage,
    arrivedAt: nowText(),
  }
  saveShuttleOps({ ...ops, ledger: [...ops.ledger, entry] })
  completeShuttleTrip(vehicles, vehicle, mileage)
  return {
    ok: true,
    message: `已确认到站：里程读数 ${mileage} 写入里程台账（趟次 ${tripId}），车辆回到待命`,
    mileage,
    tripId,
  }
}

export function listMileageLedger(): MileageLedgerEntry[] {
  return [...loadShuttleOps().ledger].reverse()
}

export function mileageSummaryByVehicle(): VehicleMileageSummary[] {
  const summary = new Map<string, VehicleMileageSummary>()
  for (const entry of loadShuttleOps().ledger) {
    const previous = summary.get(entry.vehicleNo)
    summary.set(entry.vehicleNo, {
      vehicleNo: entry.vehicleNo,
      mileage: entry.mileage,
      trips: (previous?.trips ?? 0) + 1,
      lastTripId: entry.tripId,
      lastArrivedAt: entry.arrivedAt,
    })
  }
  return [...summary.values()].sort((a, b) => a.vehicleNo.localeCompare(b.vehicleNo))
}
