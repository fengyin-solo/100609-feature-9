import { appendMileageEntry, latestMileageOf } from '@/data/mileage-ledger'
import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

// 摆渡车调度专层：按核载与路线排班、批量派车断点续派、到站里程回写维保台账。
// 通用的列表/筛选/导出仍在 local-service.ts，这里只兜摆渡车自己的规矩。

const SHUTTLE_KEY = 'shuttle'
const BATCH_KEY = 'shuttle-dispatch-batch'

// 车辆状态只能按「待命 → 执行中 → 待命」顺次推进；申请维保只允许从待命进厂。
// 其余跳步（执行中直接进维保、待命直接确认到站等）一律挡回。
const TRANSITIONS: Record<string, { from: string[]; to: string }> = {
  派发任务: { from: ['待命'], to: '执行中' },
  确认到站: { from: ['执行中'], to: '待命' },
  申请维保: { from: ['待命'], to: '维保中' },
}

export type DispatchTaskInput = {
  任务编号?: string
  人数: number
  路线: string
  时段: string
}

function shuttleRows(): EntryRow[] {
  return listRows(SHUTTLE_KEY)
}

function guardTransition(row: EntryRow, action: string): string | null {
  const rule = TRANSITIONS[action]
  if (!rule) {
    return `摆渡车没有登记「${action}」这个动作`
  }
  const current = String(row.status)
  if (!rule.from.includes(current)) {
    return `车辆状态只能按「待命 → 执行中 → 待命」顺次推进，当前「${current}」不允许「${action}」，跳步操作已挡回`
  }
  return null
}

function routeSlotBusy(
  rows: EntryRow[],
  route: string,
  slot: string,
  excludeId?: number,
): EntryRow | undefined {
  return rows.find(
    (row) =>
      Number(row.id) !== excludeId &&
      String(row.status) === '执行中' &&
      String(row['行驶路线']) === route &&
      String(row['发车时间']) === slot,
  )
}

function checkTaskInput(task: DispatchTaskInput): string | null {
  if (!Number.isFinite(task.人数) || task.人数 <= 0) {
    return '本趟人数没填对，派车单不能发'
  }
  if (!task.路线.trim() || !task.时段.trim()) {
    return '行驶路线和发车时段都要填，缺了没法按路线排班'
  }
  return null
}

// 指定车辆派发：核载不够一律拒绝，同路线同时段已有车也拒绝。
export function dispatchVehicle(vehicleId: number, task: DispatchTaskInput): ActionResult {
  const rows = shuttleRows()
  const index = rows.findIndex((row) => Number(row.id) === vehicleId)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${vehicleId} 的摆渡车` }
  }
  const row = rows[index]
  const blocked = guardTransition(row, '派发任务')
  if (blocked) {
    return { ok: false, message: blocked }
  }
  const invalid = checkTaskInput(task)
  if (invalid) {
    return { ok: false, message: invalid }
  }
  const capacity = Number(row['核载人数'])
  if (!Number.isFinite(capacity) || capacity < task.人数) {
    return {
      ok: false,
      message: `${row['车辆编号']}核载 ${row['核载人数']} 人，本趟 ${task.人数} 人，超出核载一律拒绝派发`,
    }
  }
  const busy = routeSlotBusy(rows, task.路线, task.时段, vehicleId)
  if (busy) {
    return {
      ok: false,
      message: `路线「${task.路线}」时段「${task.时段}」已有 ${busy['车辆编号']} 在执行，一条路线同一时段只允许一辆车跑`,
    }
  }
  const next = [...rows]
  next[index] = {
    ...row,
    status: '执行中',
    pending: true,
    当前任务: task.任务编号?.trim() || `${task.路线}-${task.时段}`,
    行驶路线: task.路线,
    发车时间: task.时段,
  }
  saveRows(SHUTTLE_KEY, next)
  return {
    ok: true,
    message: `${row['车辆编号']}已派发：${task.路线}（${task.时段}），本趟 ${task.人数} 人`,
  }
}

// 确认到站：里程读数取不到时按失败处理，不套用旧读数、不动车辆状态，允许再取一次。
export function confirmArrival(vehicleId: number, mileageReading: number | null): ActionResult {
  const rows = shuttleRows()
  const index = rows.findIndex((row) => Number(row.id) === vehicleId)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${vehicleId} 的摆渡车` }
  }
  const row = rows[index]
  const blocked = guardTransition(row, '确认到站')
  if (blocked) {
    return { ok: false, message: blocked }
  }
  if (mileageReading === null || !Number.isFinite(mileageReading) || mileageReading <= 0) {
    return {
      ok: false,
      message:
        '里程读数取不到，本次到站按失败处理：不拿上一次的旧值顶替，车辆仍算「执行中」，重新读取后再提交即可',
    }
  }
  const tripId = `${row['车辆编号']}@${row['发车时间']}@${row['当前任务']}`
  const { row: ledgerRow, appended } = appendMileageEntry({
    车辆编号: String(row['车辆编号']),
    趟次: tripId,
    里程读数: mileageReading,
    到站时间: new Date().toLocaleString('zh-CN', { hour12: false }),
    来源: '摆渡车到站回写',
  })
  const next = [...rows]
  next[index] = {
    ...row,
    status: '待命',
    pending: false,
    里程读数: mileageReading,
    当前任务: '无',
  }
  saveRows(SHUTTLE_KEY, next)
  if (!appended) {
    return {
      ok: true,
      message: `本趟到站已入账过（${ledgerRow['台账编号']}），重复提交只记一次里程，车辆已回「待命」`,
    }
  }
  return {
    ok: true,
    message: `${row['车辆编号']}已确认到站，里程 ${mileageReading} 已回写维保里程台账（${ledgerRow['台账编号']}）`,
  }
}

export function requestMaintenance(vehicleId: number): ActionResult {
  const rows = shuttleRows()
  const index = rows.findIndex((row) => Number(row.id) === vehicleId)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${vehicleId} 的摆渡车` }
  }
  const row = rows[index]
  const blocked = guardTransition(row, '申请维保')
  if (blocked) {
    return { ok: false, message: blocked }
  }
  const next = [...rows]
  next[index] = { ...row, status: '维保中', pending: true }
  saveRows(SHUTTLE_KEY, next)
  return { ok: true, message: `${row['车辆编号']}已申请维保，当前状态「维保中」` }
}

// 给批量派车挑车：待命、核载够、路线时段不冲突，核载够用里挑最小的，大车留给大团。
function pickVehicle(task: DispatchTaskInput): { vehicle?: EntryRow; reason?: string } {
  const rows = shuttleRows()
  const idle = rows.filter((row) => String(row.status) === '待命')
  if (!idle.length) {
    return { reason: '没有处于「待命」的摆渡车，车辆都在执行、充电或维保中' }
  }
  const capable = idle.filter((row) => Number(row['核载人数']) >= task.人数)
  if (!capable.length) {
    const max = Math.max(...idle.map((row) => Number(row['核载人数']) || 0))
    return { reason: `本趟 ${task.人数} 人超出全部待命车辆核载（最大核载 ${max} 人），超出核载一律不派` }
  }
  const free = capable.filter((row) => !routeSlotBusy(rows, task.路线, task.时段, Number(row.id)))
  if (!free.length) {
    const busy = routeSlotBusy(rows, task.路线, task.时段)
    return {
      reason: `路线「${task.路线}」时段「${task.时段}」已有 ${busy?.['车辆编号'] ?? '其他车'} 在执行，一条路线同一时段只允许一辆车跑`,
    }
  }
  const vehicle = [...free].sort(
    (a, b) => Number(a['核载人数']) - Number(b['核载人数']) || Number(a.id) - Number(b.id),
  )[0]
  return { vehicle }
}

export function listBatchTasks(): EntryRow[] {
  return listRows(BATCH_KEY)
}

function currentBatchNo(tasks: EntryRow[]): string {
  const existing = tasks.find((row) => String(row.status) !== '已派')
  if (existing) {
    return String(existing['批次号'])
  }
  return `BATCH-${new Date().toISOString().slice(0, 10)}-${String(tasks.length + 1).padStart(2, '0')}`
}

export function addBatchTask(task: DispatchTaskInput): ActionResult {
  const invalid = checkTaskInput(task)
  if (invalid) {
    return { ok: false, message: invalid }
  }
  const tasks = listBatchTasks()
  const batchNo = currentBatchNo(tasks)
  const inBatch = tasks.filter((row) => String(row['批次号']) === batchNo)
  const id = tasks.length ? Math.max(...tasks.map((row) => Number(row.id))) + 1 : 1
  const row: EntryRow = {
    id,
    status: '待派',
    pending: true,
    abnormal: false,
    批次号: batchNo,
    序号: inBatch.length + 1,
    任务编号: task.任务编号?.trim() || `${batchNo}-${inBatch.length + 1}`,
    人数: task.人数,
    路线: task.路线,
    时段: task.时段,
    车辆编号: '',
    原因: '',
  }
  saveRows(BATCH_KEY, [...tasks, row])
  return { ok: true, message: `已加入批次 ${batchNo}：${task.路线}（${task.时段}）${task.人数} 人` }
}

// 批量派车：一辆一辆落库，已派出的不退回；哪一辆派不出去就停在哪一辆，
// 原因写清，处理好后从断掉的那一辆接着排。
export function runDispatchBatch(): ActionResult {
  const tasks = listBatchTasks().map((row) => ({ ...row }))
  if (!tasks.length) {
    return { ok: false, message: '当前没有派车批次，请先把任务加入批次' }
  }
  const todo = tasks.filter((row) => String(row.status) !== '已派')
  if (!todo.length) {
    return { ok: true, message: '本批任务都已派出，没有待派的车辆' }
  }
  const batchNo = String(todo[0]['批次号'])
  let dispatched = 0
  for (const task of tasks) {
    if (String(task['批次号']) !== batchNo || String(task.status) === '已派') {
      continue
    }
    const input: DispatchTaskInput = {
      任务编号: String(task['任务编号']),
      人数: Number(task['人数']),
      路线: String(task['路线']),
      时段: String(task['时段']),
    }
    const pick = pickVehicle(input)
    if (!pick.vehicle) {
      task.status = '派不出'
      task.abnormal = true
      task['原因'] = pick.reason ?? '没有可派的摆渡车'
      saveRows(BATCH_KEY, tasks)
      return {
        ok: false,
        message: `第 ${task['序号']} 项派不出去：${task['原因']}。已派出的 ${dispatched} 辆保持「执行中」不退回，处理好后点「继续派车」从这项接着排`,
      }
    }
    const result = dispatchVehicle(Number(pick.vehicle.id), input)
    if (!result.ok) {
      task.status = '派不出'
      task.abnormal = true
      task['原因'] = result.message
      saveRows(BATCH_KEY, tasks)
      return {
        ok: false,
        message: `第 ${task['序号']} 项派发失败：${result.message}。已派出的 ${dispatched} 辆保持「执行中」不退回，可从这项接着排`,
      }
    }
    task.status = '已派'
    task.pending = false
    task.abnormal = false
    task['车辆编号'] = String(pick.vehicle['车辆编号'])
    task['原因'] = ''
    saveRows(BATCH_KEY, tasks)
    dispatched += 1
  }
  return { ok: true, message: `批次 ${batchNo} 全部派出，共 ${dispatched} 辆已上路` }
}

// 清空批次只清排队记录，已经派出的车辆照常执行，不退回。
export function clearDispatchBatch(): ActionResult {
  const tasks = listBatchTasks()
  const running = tasks.filter((row) => String(row.status) === '已派').length
  saveRows(BATCH_KEY, [])
  return {
    ok: true,
    message: running
      ? `批次已清空；其中 ${running} 辆已派出的车保持「执行中」，不随批次退回`
      : '批次已清空',
  }
}

export function shuttleMileageHint(vehicleNo: string): string {
  const latest = latestMileageOf(vehicleNo)
  return latest === null ? '暂无台账记录' : `台账最近入账 ${latest}`
}
