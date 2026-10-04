<template>
  <section class="page" data-module="shuttle">
    <header class="page-head">
      <div>
        <h2>摆渡车调度管理</h2>
        <p class="page-desc">按核载人数与行驶路线排班：超核载一律拒绝，一条路线同一时段只允许一辆车，状态按待命、执行中、待命顺次推进。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记摆渡车</button>
        <button class="btn" type="button" @click="exportRows">导出摆渡车调度清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <section class="panel">
      <h3 class="panel-title">批量派车（按核载与路线排班）</h3>
      <form class="filter-bar" @submit.prevent="addTask">
        <label class="filter-item">
          <span>任务名称</span>
          <input v-model="draft.taskName" placeholder="如 T3 到达旅客摆渡" />
        </label>
        <label class="filter-item">
          <span>乘车人数</span>
          <input v-model.number="draft.passengers" type="number" min="1" />
        </label>
        <label class="filter-item">
          <span>行驶路线</span>
          <input v-model="draft.route" list="shuttle-routes" placeholder="如 T3→卫星厅" />
        </label>
        <label class="filter-item">
          <span>发车时段</span>
          <input v-model="draft.slot" list="shuttle-slots" placeholder="如 08:00-10:00" />
        </label>
        <button class="btn" type="submit">添加任务</button>
        <button class="btn primary" type="button" :disabled="!pendingTasks.length" @click="startDispatch">
          开始派车（{{ pendingTasks.length }}）
        </button>
      </form>
      <datalist id="shuttle-routes">
        <option v-for="route in routeOptions" :key="route" :value="route" />
      </datalist>
      <datalist id="shuttle-slots">
        <option v-for="slot in slotOptions" :key="slot" :value="slot" />
      </datalist>

      <table v-if="pendingTasks.length" class="data-table">
        <thead>
          <tr>
            <th>序号</th>
            <th>任务名称</th>
            <th>乘车人数</th>
            <th>行驶路线</th>
            <th>发车时段</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(task, index) in pendingTasks" :key="index">
            <td>{{ index + 1 }}</td>
            <td>{{ task.taskName }}</td>
            <td>{{ task.passengers }}</td>
            <td>{{ task.route }}</td>
            <td>{{ task.slot }}</td>
            <td><button class="link" type="button" @click="removeTask(index)">移除</button></td>
          </tr>
        </tbody>
      </table>

      <p class="sim-row">
        <label><input v-model="simulateOutage" type="checkbox" /> 模拟车载终端断线（联调用）</label>
        <label v-if="simulateOutage">
          本批第
          <input v-model.number="breakAt" class="sim-num" type="number" min="1" />
          项派车时断线
        </label>
        <span class="sim-hint">断线同样作用于确认到站时的里程采集</span>
      </p>
    </section>

    <section v-if="batch" class="panel">
      <h3 class="panel-title">派车结果（批次 {{ batch.id }}）</h3>
      <p class="batch-summary">
        <span>共 {{ batch.tasks.length }} 项：已派 {{ dispatchedCount }}，失败 {{ failedCount }}，待派 {{ waitingCount }}</span>
        <button v-if="!batch.done" class="btn primary" type="button" @click="resumeDispatch">
          继续派车（从断点接着排）
        </button>
      </p>
      <table class="data-table">
        <thead>
          <tr>
            <th>序号</th>
            <th>任务名称</th>
            <th>乘车人数</th>
            <th>行驶路线</th>
            <th>发车时段</th>
            <th>结果</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="task in batch.tasks" :key="task.seq">
            <td>{{ task.seq }}</td>
            <td>{{ task.taskName }}</td>
            <td>{{ task.passengers }}</td>
            <td>{{ task.route }}</td>
            <td>{{ task.slot }}</td>
            <td>
              <span v-if="task.state === '已派'" class="ok-text">已派 → {{ task.vehicleNo }}</span>
              <span v-else-if="task.state === '失败'" class="error-text">派不出去：{{ task.reason }}</span>
              <span v-else>待派</span>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无摆渡车调度数据，可先登记摆渡车</td>
        </tr>
      </tbody>
    </table>

    <section class="panel">
      <h3 class="panel-title">里程台账（到站回写，与特种车辆维保读同一份）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>趟次</th>
            <th>车辆编号</th>
            <th>任务</th>
            <th>行驶路线</th>
            <th>里程读数</th>
            <th>到站时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entry in ledger" :key="entry.tripId">
            <td>{{ entry.tripId }}</td>
            <td>{{ entry.vehicleNo }}</td>
            <td>{{ entry.taskName || '—' }}</td>
            <td>{{ entry.route || '—' }}</td>
            <td>{{ entry.mileage }}</td>
            <td>{{ entry.arrivedAt }}</td>
          </tr>
          <tr v-if="!ledger.length">
            <td colspan="6" class="empty-state">暂无到站里程，确认到站后自动入账，同一趟只记一次</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条摆渡车调度记录</span>
      <span v-if="noticeMessage" class="ok-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  confirmShuttleArrival,
  downloadEntries,
  latestShuttleBatch,
  listEntries,
  listMileageLedger,
  moduleMeta,
  resumeShuttleDispatch,
  runAction as applyAction,
  startShuttleDispatch,
} from '@/api/local-service'
import type {
  EntryRow,
  MileageLedgerEntry,
  ShuttleDispatchBatch,
  ShuttleTaskInput,
} from '@/data/types'

const meta = moduleMeta('shuttle')
const columns = ["车辆编号", "核载人数", "驾驶员", "当前任务", "发车时间", "行驶路线", "里程读数", "车辆状态"]
const actions = ["确认到站", "申请维保"]
const statuses = ["待命", "执行中", "充电中", "维保中"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const stats = computed(() => [
  { label: '在册摆渡车', value: rows.value.length },
  { label: '执行中车辆', value: rows.value.filter((row) => String(row.status) === '执行中').length },
  { label: '维保中车辆', value: rows.value.filter((row) => String(row.status) === '维保中').length },
])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

// —— 批量派车 ——
const draft = ref<ShuttleTaskInput>({ taskName: '', passengers: 20, route: '', slot: '' })
const pendingTasks = ref<ShuttleTaskInput[]>([])
const batch = ref<ShuttleDispatchBatch | null>(null)
const simulateOutage = ref(false)
const breakAt = ref(2)
const ledger = ref<MileageLedgerEntry[]>([])

const slotOptions = ['06:00-08:00', '08:00-10:00', '10:00-12:00', '12:00-14:00', '14:00-16:00', '16:00-18:00', '18:00-20:00', '20:00-22:00']
const routeOptions = computed(() => {
  const inUse = rows.value.map((row) => String(row['行驶路线'] ?? '')).filter(Boolean)
  return [...new Set(['T1→远机位A', 'T2→远机位B', 'T3→卫星厅', ...inUse])]
})

const dispatchedCount = computed(() => batch.value?.tasks.filter((task) => task.state === '已派').length ?? 0)
const failedCount = computed(() => batch.value?.tasks.filter((task) => task.state === '失败').length ?? 0)
const waitingCount = computed(() => batch.value?.tasks.filter((task) => task.state === '待派').length ?? 0)

function clearMessages() {
  errorMessage.value = ''
  noticeMessage.value = ''
}

function addTask() {
  clearMessages()
  const task: ShuttleTaskInput = {
    taskName: draft.value.taskName.trim(),
    passengers: Number(draft.value.passengers),
    route: draft.value.route.trim(),
    slot: draft.value.slot.trim(),
  }
  if (!task.taskName || !task.route || !task.slot) {
    errorMessage.value = '任务名称、行驶路线、发车时段都要填'
    return
  }
  if (!Number.isFinite(task.passengers) || task.passengers < 1) {
    errorMessage.value = '乘车人数至少 1 人'
    return
  }
  pendingTasks.value = [...pendingTasks.value, task]
  draft.value = { taskName: '', passengers: task.passengers, route: task.route, slot: task.slot }
}

function removeTask(index: number) {
  pendingTasks.value = pendingTasks.value.filter((_, i) => i !== index)
}

function dispatchOptions() {
  return { breakAt: simulateOutage.value ? Math.max(1, Number(breakAt.value) || 1) : 0 }
}

function startDispatch() {
  clearMessages()
  const result = startShuttleDispatch(pendingTasks.value, dispatchOptions())
  if (result.batch.id) {
    batch.value = result.batch
    pendingTasks.value = []
  }
  showOutcome(result.ok, result.message)
  reload()
}

function resumeDispatch() {
  if (!batch.value) {
    return
  }
  clearMessages()
  const result = resumeShuttleDispatch(batch.value.id, dispatchOptions())
  batch.value = result.batch
  showOutcome(result.ok, result.message)
  reload()
}

function showOutcome(ok: boolean, message: string) {
  if (ok) {
    noticeMessage.value = message
  } else {
    errorMessage.value = message
  }
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  clearMessages()
  errorMessage.value = '摆渡车登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  clearMessages()
  if (action === '确认到站') {
    const result = confirmShuttleArrival(Number(row.id), { simulateOutage: simulateOutage.value })
    showOutcome(result.ok, result.message)
    reload()
    return
  }
  const result = applyAction(meta.key, Number(row.id), action)
  showOutcome(result.ok, result.message)
  reload()
}

function reload() {
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    ledger.value = listMileageLedger()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '摆渡车调度列表读取失败'
  }
}

onMounted(() => {
  reload()
  // 上次没派完的批次（比如断线停在中途）重新打开页面还能接着排。
  batch.value = latestShuttleBatch()
})
</script>
