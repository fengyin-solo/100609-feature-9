<template>
  <section class="page" data-module="vehmaint">
    <header class="page-head">
      <div>
        <h2>特种车辆维保管理</h2>
        <p class="page-desc">维护维保记录，围绕维保单号、车辆编号、维保类型、进厂日期做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记维保记录</button>
        <button class="btn" type="button" @click="exportRows">导出特种车辆维保清单</button>
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
          <td :colspan="columns.length + 2" class="empty-state">暂无特种车辆维保数据，可先登记维保记录</td>
        </tr>
      </tbody>
    </table>

    <section class="panel">
      <h3 class="panel-title">摆渡车里程台账</h3>
      <p class="page-desc">到站结论由摆渡车调度回写，维保侧只读这同一份台账，不另存里程副本。</p>
      <table class="data-table">
        <thead>
          <tr>
            <th>车辆编号</th>
            <th>最新里程读数</th>
            <th>累计趟次</th>
            <th>最近趟次</th>
            <th>最近到站时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in mileageSummary" :key="item.vehicleNo">
            <td>{{ item.vehicleNo }}</td>
            <td>{{ item.mileage }}</td>
            <td>{{ item.trips }}</td>
            <td>{{ item.lastTripId }}</td>
            <td>{{ item.lastArrivedAt }}</td>
          </tr>
          <tr v-if="!mileageSummary.length">
            <td colspan="5" class="empty-state">暂无里程记录，摆渡车确认到站后自动入账</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条特种车辆维保记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  mileageSummaryByVehicle,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow, VehicleMileageSummary } from '@/data/types'

const meta = moduleMeta('vehmaint')
const columns = ["维保单号", "车辆编号", "维保类型", "进厂日期", "出厂日期", "维修项目", "承修单位", "维保状态"]
const actions = ["送厂维保", "提交验收", "确认出厂"]
const statuses = ["待进厂", "维保中", "待验收", "已出厂"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const mileageSummary = ref<VehicleMileageSummary[]>([])
const stats = computed(() => [
  { label: '待进厂车辆', value: rows.value.filter((row) => String(row.status) === '待进厂').length },
  { label: '维保中车辆', value: rows.value.filter((row) => String(row.status) === '维保中').length },
  { label: '待验收车辆', value: rows.value.filter((row) => String(row.status) === '待验收').length },
])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '维保记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    mileageSummary.value = mileageSummaryByVehicle()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '特种车辆维保列表读取失败'
  }
}

onMounted(reload)
</script>
