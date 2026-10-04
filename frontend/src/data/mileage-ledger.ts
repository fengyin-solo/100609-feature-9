import { listRows, saveRows } from './local-store'
import type { EntryRow } from './types'

// 里程台账：摆渡车到站回写的里程只落这一份，特种车辆维保读的也是这一份，
// 维保记录里不再另抄一份，避免两边里程对不上。
export const MILEAGE_LEDGER_KEY = 'vehmaint-mileage-ledger'

export type MileageEntryInput = {
  车辆编号: string
  趟次: string
  里程读数: number
  到站时间: string
  来源: string
}

export function listMileageLedger(): EntryRow[] {
  return listRows(MILEAGE_LEDGER_KEY)
}

export function findTripEntry(tripId: string): EntryRow | undefined {
  return listMileageLedger().find((row) => String(row['趟次']) === tripId)
}

// 同一趟到站重复提交只记一次：趟次已入账就直接返回原记录，不再追加。
export function appendMileageEntry(input: MileageEntryInput): { row: EntryRow; appended: boolean } {
  const rows = listMileageLedger()
  const existing = rows.find((row) => String(row['趟次']) === input.趟次)
  if (existing) {
    return { row: existing, appended: false }
  }
  const id = rows.length ? Math.max(...rows.map((row) => Number(row.id))) + 1 : 1
  const row: EntryRow = {
    id,
    status: '已入账',
    pending: false,
    abnormal: false,
    台账编号: `MILE-${String(id).padStart(4, '0')}`,
    ...input,
  }
  saveRows(MILEAGE_LEDGER_KEY, [...rows, row])
  return { row, appended: true }
}

export function latestMileageOf(vehicleNo: string): number | null {
  const matched = listMileageLedger().filter((row) => String(row['车辆编号']) === vehicleNo)
  if (!matched.length) {
    return null
  }
  return Number(matched[matched.length - 1]['里程读数'])
}
