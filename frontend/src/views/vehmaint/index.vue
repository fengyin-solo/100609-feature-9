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

    <section class="ledger-panel">
      <h3>里程台账（摆渡车到站回写，维保只读这一份，不另记第二份里程）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>台账编号</th>
            <th>车辆编号</th>
            <th>趟次</th>
            <th>里程读数</th>
            <th>到站时间</th>
            <th>来源</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entry in ledgerRows" :key="String(entry.id)">
            <td>{{ entry['台账编号'] }}</td>
            <td>{{ entry['车辆编号'] }}</td>
            <td>{{ entry['趟次'] }}</td>
            <td>{{ entry['里程读数'] }}</td>
            <td>{{ entry['到站时间'] }}</td>
            <td>{{ entry['来源'] }}</td>
          </tr>
          <tr v-if="!ledgerRows.length">
            <td colspan="6" class="empty-state">暂无里程入账，摆渡车确认到站后自动回写到这份台账</td>
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
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { listMileageLedger } from '@/data/mileage-ledger'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('vehmaint')
const columns = ["维保单号", "车辆编号", "维保类型", "进厂日期", "出厂日期", "维修项目", "承修单位", "维保状态"]
const actions = ["送厂维保", "提交验收", "确认出厂"]
const statuses = ["待进厂", "维保中", "待验收", "已出厂"]
const stats = [{"label": "待进厂车辆", "value": 0}, {"label": "维保中车辆", "value": 0}, {"label": "待验收车辆", "value": 0}]

const rows = ref<EntryRow[]>([])
const ledgerRows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
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
    ledgerRows.value = listMileageLedger()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '特种车辆维保列表读取失败'
  }
}

onMounted(reload)
</script>
