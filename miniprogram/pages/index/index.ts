
type Staff = {
  id: string
  name: string
  rate: number
  allowance: number
  deduction: number
}

type Allocation = {
  staffName: string
  amount: number
}

type ClubOrder = {
  id: string
  fingerprint: string
  date: string
  boss: string
  companions: string[]
  project: string
  gift: string
  unitPrice: number
  quantity: number
  amount: number
  stageManager: string
  allocations: Allocation[]
}

type PreviewOrder = ClubOrder & {
  valid: boolean
  warning: string
}

const STAFF_KEY = 'clubPayrollStaff_v1'
const ORDER_KEY = 'clubPayrollOrders_v2'

function makeId(): string {
  return Date.now().toString() + Math.random().toString(36).slice(2, 8)
}

function money(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2)
}

function currentMonth(): string {
  const d = new Date()
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0')
}

function getField(text: string, name: string): string {
  const lines = text.split(/\r?\n/)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    const re = new RegExp(
      '^(?:💫|🪐)?\\s*' + name + '\\s*[:：]\\s*(.*)$'
    )
    const match = line.match(re)

    if (match) return match[1].trim()
  }

  return ''
}

function getNumberField(text: string, name: string): number | null {
  const value = getField(text, name).replace(/[￥¥元,\s，]/g, '')

  if (!value || !/^\d+(\.\d+)?$/.test(value)) {
    return null
  }

  return Number(value)
}

function parseDate(value: string): string {
  const year = new Date().getFullYear()
  let match = value.match(
    /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/
  )

  if (match) {
    return match[1] + '-' +
      match[2].padStart(2, '0') + '-' +
      match[3].padStart(2, '0')
  }

  match = value.match(/^(\d{1,2})[-/.月](\d{1,2})日?$/)

  if (match) {
    return year + '-' +
      match[1].padStart(2, '0') + '-' +
      match[2].padStart(2, '0')
  }

  return ''
}

function parseCompanions(value: string): string[] {
  const parts = value.split(/[\s、,，;；|]+/)
  const names: string[] = []

  parts.forEach(function (part) {
    const name = part.trim()

    if (name && names.indexOf(name) === -1) {
      names.push(name)
    }
  })

  return names
}

function splitAmount(names: string[], total: number): Allocation[] {
  if (names.length === 0) return []

  const cents = Math.round(total * 100)
  const base = Math.floor(cents / names.length)
  const remainder = cents % names.length

  return names.map(function (name, index) {
    const assignedCents = base + (index < remainder ? 1 : 0)

    return {
      staffName: name,
      amount: assignedCents / 100
    }
  })
}

function parseReceipt(text: string): PreviewOrder {
  const boss = getField(text, '老板')
  const companions = parseCompanions(getField(text, '陪陪'))
  const project = getField(text, '项目')
  const gift = getField(text, '礼物')
  const unitPrice = getNumberField(text, '金额')
  const quantity = getNumberField(text, '数量')
  const printedTotal = getNumberField(text, '总额')
  const stageManager = getField(text, '场控')
  const date = parseDate(getField(text, '日期'))

  const warnings: string[] = []
  let amount = 0

  if (printedTotal !== null) {
    amount = printedTotal
  } else if (unitPrice !== null && quantity !== null) {
    amount = Math.round(unitPrice * quantity * 100) / 100
    warnings.push('没有识别到总额，已按单价乘数量计算')
  } else {
    warnings.push('无法识别订单总额')
  }

  if (!boss) warnings.push('缺少老板')
  if (companions.length === 0) warnings.push('缺少陪陪名单')
  if (!project) warnings.push('缺少项目')
  if (unitPrice === null) warnings.push('无法识别金额')
  if (quantity === null) warnings.push('无法识别数量')
  if (!date) warnings.push('无法识别日期')

  const mismatch =
    printedTotal !== null &&
    unitPrice !== null &&
    quantity !== null &&
    Math.abs(printedTotal - unitPrice * quantity) > 0.011

  if (mismatch) {
    warnings.push('总额与金额乘数量不一致，请核对')
  }

  const fingerprint = [
    date,
    boss,
    companions.slice().sort().join(','),
    project,
    gift,
    unitPrice === null ? '' : money(unitPrice),
    quantity === null ? '' : String(quantity),
    money(amount),
    stageManager
  ].join('|')

  const valid =
    !!boss &&
    companions.length > 0 &&
    !!project &&
    unitPrice !== null &&
    quantity !== null &&
    !!date &&
    printedTotal !== null &&
    !mismatch

  return {
    id: makeId(),
    fingerprint: fingerprint,
    date: date,
    boss: boss,
    companions: companions,
    project: project,
    gift: gift,
    unitPrice: unitPrice === null ? 0 : unitPrice,
    quantity: quantity === null ? 0 : quantity,
    amount: amount,
    stageManager: stageManager,
    allocations: splitAmount(companions, amount),
    valid: valid,
    warning: warnings.join('；')
  }
}

Page({
  data: {
    tab: 'orders',
    batchText: '',
    previewOrders: [] as PreviewOrder[],
    previewMessage: '',
    staff: [] as Staff[],
    orders: [] as ClubOrder[],
    month: currentMonth(),

    staffName: '',
    staffRate: '30',
    staffAllowance: '0',
    staffDeduction: '0',

    payrollRows: [] as any[],
    payrollOrderTotal: '0.00',
    payrollAllocationTotal: '0.00',
    payrollCommissionTotal: '0.00',
    payrollPayableTotal: '0.00'
  },

  onLoad: function () {
    this.loadAll()
  },

  loadAll: function () {
    let staff: Staff[] = []
    let orders: ClubOrder[] = []

    try {
      staff = wx.getStorageSync(STAFF_KEY) || []
      orders = wx.getStorageSync(ORDER_KEY) || []
    } catch (e) {
      wx.showToast({ title: '读取数据失败', icon: 'none' })
    }

    this.setData({
      staff: staff,
      orders: orders
    })

    this.calculatePayroll()
  },

  saveAll: function (staff: Staff[], orders: ClubOrder[]) {
    try {
      wx.setStorageSync(STAFF_KEY, staff)
      wx.setStorageSync(ORDER_KEY, orders)

      this.setData({
        staff: staff,
        orders: orders
      })

      this.calculatePayroll()
      return true
    } catch (e) {
      wx.showToast({ title: '保存失败', icon: 'none' })
      return false
    }
  },

  setTab: function (e: any) {
    const tab = e.currentTarget.dataset.tab
    this.setData({ tab: tab })

    if (tab === 'payroll') {
      this.calculatePayroll()
    }
  },

  onBatchInput: function (e: any) {
    this.setData({ batchText: e.detail.value })
  },

  onInput: function (e: any) {
    const key = e.currentTarget.dataset.field
    const update: any = {}
    update[key] = e.detail.value
    this.setData(update)
  },

  onMonthInput: function (e: any) {
    this.setData({ month: e.detail.value })
    this.calculatePayroll()
  },

  parseBatch: function () {
    const raw = (this.data.batchText || '').trim()

    if (!raw) {
      wx.showToast({ title: '请先粘贴小票', icon: 'none' })
      return
    }

    const chunks = raw
      .split(/(?=(?:💫|🪐)?\s*老板\s*[:：])/)
      .filter(function (part) {
        return /老板\s*[:：]/.test(part)
      })

    if (chunks.length === 0) {
      wx.showModal({
        title: '没有识别到小票',
        content: '请确认小票包含“老板：”字段。',
        showCancel: false
      })
      return
    }

    const previews = chunks.map(function (chunk) {
      return parseReceipt(chunk)
    })

    const validCount = previews.filter(function (order) {
      return order.valid
    }).length

    this.setData({
      previewOrders: previews,
      previewMessage: '共识别 ' + previews.length +
        ' 张小票，其中 ' + validCount + ' 张通过基本检查。'
    })

    // 识别时就检查与已保存订单是否相同，只提醒，不删除
    const savedFingerprints = this.data.orders.map(function (order) {
      return order.fingerprint
    })

    const duplicates = previews.filter(function (order) {
      return order.valid &&
        savedFingerprints.indexOf(order.fingerprint) !== -1
    }).length

    if (duplicates > 0) {
      wx.showModal({
        title: '发现相同订单',
        content: '发现 ' + duplicates +
          ' 张与已保存订单内容相同的小票。相同内容也可能是正常订单，系统不会自动取消或跳过。',
        confirmText: '知道了',
        showCancel: false
      })
    }
  },

  saveParsedOrders: function () {
    const previews = this.data.previewOrders
    const existing = this.data.orders.slice()

    if (previews.length === 0) {
      wx.showToast({ title: '请先识别小票', icon: 'none' })
      return
    }

    const existingFingerprints = existing.map(function (order) {
      return order.fingerprint
    })

    const newOrders: ClubOrder[] = []
    let invalid = 0
    let duplicate = 0
    const seen = existingFingerprints.slice()

    previews.forEach(function (item) {
      if (!item.valid) {
        invalid++
        return
      }

      if (seen.indexOf(item.fingerprint) !== -1) {
        duplicate++
      }

      // 即使内容相同，也保留该订单，不自动跳过
      newOrders.push({
        id: item.id,
        fingerprint: item.fingerprint,
        date: item.date,
        boss: item.boss,
        companions: item.companions,
        project: item.project,
        gift: item.gift,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        amount: item.amount,
        stageManager: item.stageManager,
        allocations: item.allocations
      })

      seen.push(item.fingerprint)
    })

    if (newOrders.length === 0) {
      wx.showModal({
        title: '没有有效订单',
        content: '有 ' + invalid + ' 张小票未通过检查，请核对后再保存。',
        showCancel: false
      })
      return
    }

    const that = this

    function confirmSave() {
      wx.showModal({
        title: '确认保存订单',
        content: '确定保存这 ' + newOrders.length +
          ' 张订单吗？保存后会计入工资统计。未通过检查的 ' +
          invalid + ' 张不会保存。',
        confirmText: '确认保存',
        cancelText: '返回检查',
        success: function (res) {
          if (!res.confirm) return

          const updated = existing.concat(newOrders)

          if (that.saveAll(that.data.staff, updated)) {
            that.setData({
              batchText: '',
              previewOrders: [],
              previewMessage: ''
            })

            wx.showToast({ title: '保存成功', icon: 'success' })
          }
        }
      })
    }

    if (duplicate > 0) {
      wx.showModal({
        title: '⚠️ 发现相同订单',
        content: '发现 ' + duplicate +
          ' 张内容相同的订单。相同内容可能是正常下单，请核对。选择“继续确认”后还会再询问一次是否保存。',
        confirmText: '继续确认',
        cancelText: '返回检查',
        success: function (res) {
          if (res.confirm) {
            confirmSave()
          }
        }
      })
    } else {
      confirmSave()
    }
  },

  addStaff: function () {
    const name = this.data.staffName.trim()
    const rate = Number(this.data.staffRate)
    const allowance = Number(this.data.staffAllowance)
    const deduction = Number(this.data.staffDeduction)

    if (!name) {
      wx.showToast({ title: '请输入员工姓名', icon: 'none' })
      return
    }

    if (this.data.staff.some(function (person) {
      return person.name === name
    })) {
      wx.showToast({ title: '员工已存在', icon: 'none' })
      return
    }

    if (
      !Number.isFinite(rate) || rate < 0 || rate > 100 ||
      !Number.isFinite(allowance) || allowance < 0 ||
      !Number.isFinite(deduction) || deduction < 0
    ) {
      wx.showToast({ title: '请检查工资设置', icon: 'none' })
      return
    }

    const updated = this.data.staff.concat([{
      id: makeId(),
      name: name,
      rate: rate,
      allowance: allowance,
      deduction: deduction
    }])

    if (this.saveAll(updated, this.data.orders)) {
      this.setData({
        staffName: '',
        staffRate: '30',
        staffAllowance: '0',
        staffDeduction: '0'
      })

      wx.showToast({ title: '员工已添加', icon: 'success' })
    }
  },

  deleteStaff: function (e: any) {
    const id = e.currentTarget.dataset.id
    const person = this.data.staff.find(function (item) {
      return item.id === id
    })

    if (!person) return

    const used = this.data.orders.some(function (order) {
      return order.allocations.some(function (allocation) {
        return allocation.staffName === person.name
      })
    })

    if (used) {
      wx.showModal({
        title: '不能删除',
        content: '该员工已出现在订单记录中，为保留历史数据，暂不允许删除。',
        showCancel: false
      })
      return
    }

    const that = this

    wx.showModal({
      title: '删除员工',
      content: '确定删除 ' + person.name + ' 吗？',
      success: function (res) {
        if (!res.confirm) return

        const updated = that.data.staff.filter(function (item) {
          return item.id !== id
        })

        that.saveAll(updated, that.data.orders)
      }
    })
  },

  deleteOrder: function (e: any) {
    const id = e.currentTarget.dataset.id
    const that = this

    wx.showModal({
      title: '删除订单',
      content: '确定删除这笔订单吗？删除后该订单不再计入工资统计。',
      success: function (res) {
        if (!res.confirm) return

        const updated = that.data.orders.filter(function (order) {
          return order.id !== id
        })

        that.saveAll(that.data.staff, updated)
      }
    })
  },

  calculatePayroll: function () {
    const month = this.data.month || currentMonth()

    const orders = this.data.orders.filter(function (order) {
      return order.date.indexOf(month) === 0
    })

    let orderCents = 0

    orders.forEach(function (order) {
      orderCents += Math.round(order.amount * 100)
    })

    let allocationCents = 0
    let commissionCents = 0
    let payableCents = 0

    const rows = this.data.staff.map(function (person) {
      let allocated = 0
      let count = 0

      orders.forEach(function (order) {
        order.allocations.forEach(function (allocation) {
          if (allocation.staffName === person.name) {
            allocated += Math.round(allocation.amount * 100)
            count++
          }
        })
      })

      const commission = Math.round(allocated * person.rate / 100)
      const allowance = count > 0 ?
        Math.round(person.allowance * 100) : 0
      const deduction = count > 0 ?
        Math.round(person.deduction * 100) : 0
      const payable = commission + allowance - deduction

      allocationCents += allocated
      commissionCents += commission
      payableCents += payable

      return {
        id: person.id,
        name: person.name,
        orderCount: count,
        allocatedText: money(allocated / 100),
        commissionText: money(commission / 100),
        allowanceText: money(allowance / 100),
        deductionText: money(deduction / 100),
        payableText: money(payable / 100)
      }
    })

    this.setData({
      payrollRows: rows,
      payrollOrderTotal: money(orderCents / 100),
      payrollAllocationTotal: money(allocationCents / 100),
      payrollCommissionTotal: money(commissionCents / 100),
      payrollPayableTotal: money(payableCents / 100)
    })
  }
})
