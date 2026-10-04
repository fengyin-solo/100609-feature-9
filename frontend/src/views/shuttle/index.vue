<template>
  <section class="page" data-module="shuttle">
    <header class="page-head">
      <div>
        <h2>摆渡车调度管理</h2>
        <p class="page-desc">按核载人数与行驶路线排班：超核载一律拒派，一条路线同一时段只允许一辆车跑。</p>
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

    <section class="batch-panel">
      <h3>批量派车（按核载与路线排班）</h3>
      <form class="filter-bar" @submit.prevent="addTask">
        <label class="filter-item">
          <span>任务编号（选填）</span>
          <input v-model="batchForm.任务编号" placeholder="留空自动编号" />
        </label>
        <label class="filter-item">
          <span>本趟人数</span>
          <input v-model="batchForm.人数" type="number" min="1" placeholder="如 40" />
        </label>
        <label class="filter-item">
          <span>行驶路线</span>
          <input v-model="batchForm.路线" placeholder="如 T2航站楼—卫星厅" />
        </label>
        <label class="filter-item">
          <span>发车时段</span>
          <input v-model="batchForm.时段" placeholder="如 08:00-08:30" />
        </label>
        <button class="btn" type="submit">加入批次</button>
        <button class="btn primary" type="button" @click="runBatch">
          {{ batchHasBreakpoint ? '继续派车（从断点接着排）' : '开始派车' }}
        </button>
        <button class="btn ghost" type="button" @click="clearBatch">清空批次</button>
      </form>
      <table v-if="batchTasks.length" class="data-table">
        <thead>
          <tr>
            <th>批次号</th>
            <th>序号</th>
            <th>任务编号</th>
            <th>人数</th>
            <th>路线</th>
            <th>时段</th>
            <th>派车状态</th>
            <th>派出的车</th>
            <th>派不出去的原因</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="task in batchTasks" :key="String(task.id)">
            <td>{{ task['批次号'] }}</td>
            <td>{{ task['序号'] }}</td>
            <td>{{ task['任务编号'] }}</td>
            <td>{{ task['人数'] }}</td>
            <td>{{ task['路线'] }}</td>
            <td>{{ task['时段'] }}</td>
            <td>{{ task.status }}</td>
            <td>{{ task['车辆编号'] || '—' }}</td>
            <td class="error-text">{{ task['原因'] || '—' }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty-state">批次为空：先把任务加入批次，再一次派出去；中途派不出去会停在断点，可接着排</p>
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

    <footer class="page-foot">
      <span>共 {{ total }} 条摆渡车调度记录</span>
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="dispatchDialog" class="modal-mask" @click.self="closeDispatch">
      <div class="modal-card">
        <h3>派发任务 · {{ dispatchDialog.车辆编号 }}</h3>
        <p class="modal-hint">核载 {{ dispatchDialog.核载人数 }} 人，超出核载一律拒绝；同路线同时段已有车也会被挡回。</p>
        <form @submit.prevent="submitDispatch">
          <div class="form-row">
            <label>任务编号（选填）</label>
            <input v-model="dispatchForm.任务编号" placeholder="留空按路线时段生成" />
          </div>
          <div class="form-row">
            <label>本趟人数</label>
            <input v-model="dispatchForm.人数" type="number" min="1" placeholder="如 40" />
          </div>
          <div class="form-row">
            <label>行驶路线</label>
            <input v-model="dispatchForm.路线" placeholder="如 T2航站楼—卫星厅" />
          </div>
          <div class="form-row">
            <label>发车时段</label>
            <input v-model="dispatchForm.时段" placeholder="如 08:00-08:30" />
          </div>
          <p v-if="dialogError" class="error-text">{{ dialogError }}</p>
          <div class="modal-actions">
            <button class="btn ghost" type="button" @click="closeDispatch">取消</button>
            <button class="btn primary" type="submit">确认派发</button>
          </div>
        </form>
      </div>
    </div>

    <div v-if="arrivalDialog" class="modal-mask" @click.self="closeArrival">
      <div class="modal-card">
        <h3>确认到站 · {{ arrivalDialog.车辆编号 }}</h3>
        <p class="modal-hint">
          当前任务：{{ arrivalDialog.当前任务 }}；{{ arrivalDialog.里程提示 }}。
          里程读数以本次读取为准，取不到就提交空值按失败处理，不会拿旧值顶替，可重新读取再提交。
        </p>
        <form @submit.prevent="submitArrival">
          <div class="form-row">
            <label>里程读数（取不到请留空）</label>
            <input v-model="arrivalForm.里程读数" type="number" min="1" placeholder="本次读取的里程表读数" />
          </div>
          <p v-if="dialogError" class="error-text">{{ dialogError }}</p>
          <div class="modal-actions">
            <button class="btn ghost" type="button" @click="closeArrival">取消</button>
            <button class="btn primary" type="submit">提交到站</button>
          </div>
        </form>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
} from '@/api/local-service'
import {
  addBatchTask,
  clearDispatchBatch,
  confirmArrival,
  dispatchVehicle,
  listBatchTasks,
  requestMaintenance,
  runDispatchBatch,
  shuttleMileageHint,
} from '@/api/shuttle-dispatch'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('shuttle')
const columns = ["车辆编号", "核载人数", "驾驶员", "当前任务", "发车时间", "行驶路线", "里程读数", "车辆状态"]
const actions = ["派发任务", "确认到站", "申请维保"]
const statuses = ["待命", "执行中", "充电中", "维保中"]
const stats = [{"label": "在册摆渡车", "value": 0}, {"label": "执行中车辆", "value": 0}, {"label": "维保中车辆", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const batchForm = ref({ 任务编号: '', 人数: '', 路线: '', 时段: '' })
const batchTasks = ref<EntryRow[]>([])
const batchHasBreakpoint = computed(() =>
  batchTasks.value.some((task) => String(task.status) !== '已派'),
)

const dispatchDialog = ref<{ id: number; 车辆编号: string; 核载人数: string | number | boolean } | null>(null)
const dispatchForm = ref({ 任务编号: '', 人数: '', 路线: '', 时段: '' })
const arrivalDialog = ref<{ id: number; 车辆编号: string; 当前任务: string; 里程提示: string } | null>(null)
const arrivalForm = ref({ 里程读数: '' })
const dialogError = ref('')

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '摆渡车登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  if (action === '派发任务') {
    dispatchForm.value = { 任务编号: '', 人数: '', 路线: '', 时段: '' }
    dialogError.value = ''
    dispatchDialog.value = { id: Number(row.id), 车辆编号: String(row['车辆编号']), 核载人数: row['核载人数'] }
    return
  }
  if (action === '确认到站') {
    arrivalForm.value = { 里程读数: '' }
    dialogError.value = ''
    arrivalDialog.value = {
      id: Number(row.id),
      车辆编号: String(row['车辆编号']),
      当前任务: String(row['当前任务'] ?? '无'),
      里程提示: shuttleMileageHint(String(row['车辆编号'])),
    }
    return
  }
  const result = requestMaintenance(Number(row.id))
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  reload()
}

function closeDispatch() {
  dispatchDialog.value = null
}

function submitDispatch() {
  const dialog = dispatchDialog.value
  if (!dialog) {
    return
  }
  const result = dispatchVehicle(dialog.id, {
    任务编号: dispatchForm.value.任务编号,
    人数: Number(dispatchForm.value.人数),
    路线: dispatchForm.value.路线.trim(),
    时段: dispatchForm.value.时段.trim(),
  })
  if (!result.ok) {
    dialogError.value = result.message
    return
  }
  dispatchDialog.value = null
  noticeMessage.value = result.message
  reload()
}

function closeArrival() {
  arrivalDialog.value = null
}

function submitArrival() {
  const dialog = arrivalDialog.value
  if (!dialog) {
    return
  }
  const raw = arrivalForm.value.里程读数.trim()
  const result = confirmArrival(dialog.id, raw === '' ? null : Number(raw))
  if (!result.ok) {
    // 取不到读数按失败处理：弹窗不关，允许重新读取再提交
    dialogError.value = result.message
    return
  }
  arrivalDialog.value = null
  noticeMessage.value = result.message
  reload()
}

function addTask() {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = addBatchTask({
    任务编号: batchForm.value.任务编号,
    人数: Number(batchForm.value.人数),
    路线: batchForm.value.路线.trim(),
    时段: batchForm.value.时段.trim(),
  })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  batchForm.value = { 任务编号: '', 人数: '', 路线: '', 时段: '' }
  noticeMessage.value = result.message
  reloadBatch()
}

function runBatch() {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = runDispatchBatch()
  if (!result.ok) {
    errorMessage.value = result.message
  } else {
    noticeMessage.value = result.message
  }
  reload()
  reloadBatch()
}

function clearBatch() {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = clearDispatchBatch()
  noticeMessage.value = result.message
  reloadBatch()
}

function reloadBatch() {
  batchTasks.value = listBatchTasks()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '摆渡车调度列表读取失败'
  }
}

onMounted(() => {
  reload()
  reloadBatch()
})
</script>
