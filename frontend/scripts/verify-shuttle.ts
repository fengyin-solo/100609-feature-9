// 派车排班逻辑端到端校验：node 环境下 localStorage 缺省，数据层自动走内存种子数据。
import {
  confirmShuttleArrival,
  latestShuttleBatch,
  listEntries,
  listMileageLedger,
  mileageSummaryByVehicle,
  resumeShuttleDispatch,
  runAction,
  startShuttleDispatch,
} from '@/api/local-service'

let failures = 0
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ✔ ${name}`)
  } else {
    failures += 1
    console.error(`  ✘ ${name}`, detail ?? '')
  }
}

function shuttleRow(id: number) {
  return listEntries('shuttle').items.find((row) => Number(row.id) === id)!
}

console.log('场景1：超出核载一律拒绝，并给出原因')
{
  const res = startShuttleDispatch([
    { taskName: '超大团队摆渡', passengers: 50, route: 'T1→远机位A', slot: '10:00-12:00' },
  ])
  check('派车失败', !res.ok)
  check('原因指明超出核载', res.batch.tasks[0].reason?.includes('超出核载') ?? false, res.batch.tasks[0].reason)
  check('车辆状态未被改动', String(shuttleRow(1).status) === '待命')
}

console.log('场景2：一条路线同一时段只允许一辆车')
{
  const res = startShuttleDispatch([
    { taskName: '撞线任务', passengers: 10, route: 'T3→卫星厅', slot: '08:00-10:00' },
  ])
  check('派车失败', !res.ok)
  check('原因指明路线时段冲突', res.batch.tasks[0].reason?.includes('同一时段只允许一辆车') ?? false, res.batch.tasks[0].reason)
}

console.log('场景3：中途断线——已派保留不回退，从断掉的那一项接着排')
{
  const res = startShuttleDispatch(
    [
      { taskName: '任务一', passengers: 20, route: 'T1→远机位A', slot: '10:00-12:00' },
      { taskName: '任务二', passengers: 20, route: 'T2→远机位B', slot: '10:00-12:00' },
      { taskName: '任务三', passengers: 20, route: 'T3→卫星厅', slot: '12:00-14:00' },
    ],
    { breakAt: 2 },
  )
  const batch = res.batch
  check('第1项已派出', batch.tasks[0].state === '已派' && batch.tasks[0].vehicleNo === 'SHUT-0001')
  check('第2项断线失败', batch.tasks[1].state === '失败' && (batch.tasks[1].reason?.includes('断线') ?? false))
  check('第3项仍是待派', batch.tasks[2].state === '待派')
  check('批次未办结（不能停在半路）', !batch.done)
  check('已派车辆真的在执行', String(shuttleRow(1).status) === '执行中' && String(shuttleRow(1)['当前任务']) === '任务一')
  check('断点批次落库，刷新后还在', latestShuttleBatch()?.id === batch.id)

  // 把执行中的车跑完到站，腾出车来再续派
  const arrival = confirmShuttleArrival(1)
  check('任务一车辆到站', arrival.ok, arrival.message)
  const resumed = resumeShuttleDispatch(batch.id)
  check('续派从断掉的第2项接着来', resumed.batch.tasks[1].state === '已派' && resumed.batch.tasks[1].vehicleNo === 'SHUT-0001')
  check('第3项没车可派时有明确原因', resumed.batch.tasks[2].state === '失败' && (resumed.batch.tasks[2].reason?.includes('没有待命车辆') ?? false), resumed.batch.tasks[2].reason)
  check('批次办结', resumed.batch.done)
}

console.log('场景4：取不到里程读数按失败处理，不拿旧值顶替，可再取一次')
{
  const before = Number(shuttleRow(1)['里程读数'])
  const ledgerBefore = listMileageLedger().length
  const failed = confirmShuttleArrival(1, { simulateOutage: true })
  check('采集失败', !failed.ok)
  check('车辆保持执行中', String(shuttleRow(1).status) === '执行中')
  check('里程读数没被旧值顶替', Number(shuttleRow(1)['里程读数']) === before)
  check('台账没有入账', listMileageLedger().length === ledgerBefore)
  const retried = confirmShuttleArrival(1)
  check('恢复后重取成功', retried.ok, retried.message)
  check('车辆回到待命', String(shuttleRow(1).status) === '待命')
  check('新里程大于旧里程', Number(shuttleRow(1)['里程读数']) > before)
}

console.log('场景5：同一趟到站重复提交只记一次里程')
{
  const ledgerBefore = listMileageLedger().length
  const again = confirmShuttleArrival(1)
  check('到站后重复提交被挡回', !again.ok, again.message)
  check('提示顺次推进', again.message.includes('顺次推进'))
  check('台账没有第二份里程', listMileageLedger().length === ledgerBefore)
}

console.log('场景6：种子里的在执行车辆（无趟次）也能正常到站入账')
{
  const res = confirmShuttleArrival(2)
  check('到站成功', res.ok, res.message)
  check('趟次为 TRIP-LEGACY-2', res.tripId === 'TRIP-LEGACY-2')
  check('车辆回到待命', String(shuttleRow(2).status) === '待命')
}

console.log('场景7：车辆状态只按待命、执行中、待命顺次推进，跳步挡回')
{
  const dispatchOnIdle = runAction('shuttle', 1, '派发任务')
  check('待命可直接派发（通用动作校验通过）', dispatchOnIdle.ok, dispatchOnIdle.message)
  const dispatchAgain = runAction('shuttle', 1, '派发任务')
  check('执行中再派发被挡回', !dispatchAgain.ok && dispatchAgain.message.includes('顺次推进'), dispatchAgain.message)
  const maintainBusy = runAction('shuttle', 1, '申请维保')
  check('执行中申请维保被挡回', !maintainBusy.ok && maintainBusy.message.includes('顺次推进'), maintainBusy.message)
  const arrive = runAction('shuttle', 1, '确认到站')
  check('执行中确认到站放行', arrive.ok, arrive.message)
  const arriveAgain = runAction('shuttle', 1, '确认到站')
  check('待命再确认到站被挡回', !arriveAgain.ok && arriveAgain.message.includes('顺次推进'), arriveAgain.message)
  const maintain = runAction('shuttle', 1, '申请维保')
  check('待命申请维保放行', maintain.ok, maintain.message)
  check('车辆状态字段同步', String(shuttleRow(1)['车辆状态']) === '维保中')
}

console.log('场景8：维保侧读到的里程台账是同一份，不出现第二份')
{
  const ledger = listMileageLedger()
  const summary = mileageSummaryByVehicle()
  const shut1 = summary.find((item) => item.vehicleNo === 'SHUT-0001')
  check('台账有到站记录', ledger.length >= 2, ledger.length)
  check('SHUT-0001 汇总里程与台账最后一笔一致',
    shut1?.mileage === ledger.filter((e) => e.vehicleNo === 'SHUT-0001').at(0)?.mileage,
    shut1)
  check('SHUT-0001 累计趟次与台账一致',
    shut1?.trips === ledger.filter((e) => e.vehicleNo === 'SHUT-0001').length)
}

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项未通过`)
process.exit(failures === 0 ? 0 : 1)
