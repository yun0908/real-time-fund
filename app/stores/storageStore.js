import { create } from 'zustand';
import { isEqual, isArray, isPlainObject, isString } from 'lodash';
import { getFundCodesFromTagRecord } from '@/app/lib/fundHelpers';

/**
 * 签名函数：用于检测 funds 列表是否发生实质性变更（jzrq, dwjz 等核心字段）
 */
export const getFundCodesSignature = (value, extraFields = []) => {
  try {
    const list = Array.isArray(value) ? value : JSON.parse(value || '[]');
    if (!Array.isArray(list)) return '';
    const fields = Array.from(new Set([
      'jzrq',
      'dwjz',
      'dataSource',
      ...(Array.isArray(extraFields) ? extraFields : [])
    ]));
    const items = list.map((item) => {
      if (!item?.code) return null;
      const extras = fields.map((field) => item?.[field] ?? '').join(':');
      return `${item.code}:${extras}`;
    }).filter(Boolean);
    return Array.from(new Set(items)).join('|');
  } catch (e) {
    return '';
  }
};

/**
 * 签名函数：用于检测 tags 存储是否发生实质性变更
 */
export const getTagsStoreSignature = (value) => {
  try {
    const list = Array.isArray(value) ? value : JSON.parse(value || '[]');
    if (!Array.isArray(list)) return '';
    return list
      .map((r) => {
        const codes = getFundCodesFromTagRecord(r).sort().join(',');
        return `${codes}\u001e${String(r?.id ?? '').trim()}\u001e${String(r?.name ?? '').trim()}\u001e${String(r?.theme ?? '').trim()}`;
      })
      .sort()
      .join('|');
  } catch (e) {
    return '';
  }
};

/**
 * 仅以下 key 参与云端同步
 */
const SYNC_KEYS = new Set([
  'funds', 'tags', 'favorites', 'groups', 
  'collapsedCodes', 'collapsedTrends', 'collapsedEarnings', 
  'refreshMs', 'holdings', 'groupHoldings', 'pendingTrades', 
  'transactions', 'dcaPlans', 'customSettings', 'fundDailyEarnings'
]);

/** 排序展示模式的合法值集合 */
export const SORT_DISPLAY_MODES = new Set(['buttons', 'dropdown']);

/** 排序规则的默认配置 */
export const DEFAULT_SORT_RULES = [
  { id: 'default', label: '默认', enabled: true },
  { id: 'yield', label: '估算涨幅', alias: '涨跌幅', enabled: true },
  { id: 'yesterdayIncrease', label: '最新涨幅', enabled: false },
  { id: 'holdingAmount', label: '持仓金额', enabled: false },
  { id: 'holdingRatio', label: '持仓占比', enabled: false },
  { id: 'todayProfit', label: '当日收益', enabled: false },
  { id: 'yesterdayProfit', label: '昨日收益', enabled: false },
  { id: 'holdingDays', label: '持有天数', enabled: false },
  { id: 'holding', label: '持有收益', enabled: true },
  { id: 'estimateProfit', label: '估算收益', enabled: false },
  { id: 'holdingCost', label: '持仓成本', enabled: false },
  { id: 'last1Week', label: '近1周', enabled: false },
  { id: 'last1Month', label: '近1月', enabled: false },
  { id: 'last3Months', label: '近3月', enabled: false },
  { id: 'last6Months', label: '近6月', enabled: false },
  { id: 'last1Year', label: '近1年', enabled: false },
  { id: 'sinceAddedChangePercent', label: '自添加来', enabled: false },
  { id: 'tags', label: '基金标签', enabled: false },
  { id: 'name', label: '基金名称', alias: '名称', enabled: true },
];

const cloneDefaultSortRules = () => DEFAULT_SORT_RULES.map((rule) => ({ ...rule }));

const createDefaultStoreState = () => ({
  funds: [],
  groups: [],
  favorites: new Set(),
  collapsedCodes: new Set(),
  collapsedTrends: new Set(),
  collapsedEarnings: new Set(),
  refreshMs: 30000,
  holdings: {},
  groupHoldings: {},
  pendingTrades: [],
  transactions: {},
  dcaPlans: {},
  customSettings: {},
  fundDailyEarnings: {},
  sortBy: 'default',
  sortOrder: 'desc',
  pcSortDisplayMode: 'buttons',
  mobileSortDisplayMode: 'buttons',
  sortRules: cloneDefaultSortRules(),
});

const CLEARABLE_STORAGE_KEYS = [
  ...SYNC_KEYS,
  'tags',
  'fundValuationTimeseries',
  'localSortBy',
  'localSortOrder',
  'localSortRules',
  'currentTab',
  'viewMode',
  'localUpdatedAt',
];

const normalizeFundDailyEarningsState = (parsed) => {
  if (!isPlainObject(parsed)) return {};
  const values = Object.values(parsed);
  const hasScoped = values.some((v) => isPlainObject(v) && !isArray(v));
  if (!hasScoped && Object.keys(parsed).length > 0) {
    return { all: parsed };
  }
  return parsed;
};

const getSortStateFromSettings = (settings, legacyRules = null) => {
  if (!isPlainObject(settings)) return {};

  const nextState = {};

  if (isString(settings.localSortDisplayMode) && SORT_DISPLAY_MODES.has(settings.localSortDisplayMode)) {
    nextState.pcSortDisplayMode = settings.localSortDisplayMode;
    nextState.mobileSortDisplayMode = settings.localSortDisplayMode;
  } else {
    if (isString(settings.pcLocalSortDisplayMode) && SORT_DISPLAY_MODES.has(settings.pcLocalSortDisplayMode)) {
      nextState.pcSortDisplayMode = settings.pcLocalSortDisplayMode;
    }
    if (isString(settings.mobileLocalSortDisplayMode) && SORT_DISPLAY_MODES.has(settings.mobileLocalSortDisplayMode)) {
      nextState.mobileSortDisplayMode = settings.mobileLocalSortDisplayMode;
    }
  }

  const rulesSource = isArray(settings.localSortRules) && settings.localSortRules.length
    ? settings.localSortRules
    : (isArray(legacyRules) && legacyRules.length ? legacyRules : null);

  if (rulesSource) {
    const defaultMap = new Map(DEFAULT_SORT_RULES.map((r) => [r.id, r]));
    const merged = [];
    rulesSource.forEach((stored) => {
      const base = defaultMap.get(stored?.id);
      if (!base) return;
      merged.push({
        ...base,
        enabled: typeof stored.enabled === 'boolean' ? stored.enabled : base.enabled,
        alias: isString(stored.alias) && stored.alias.trim() ? stored.alias.trim() : base.alias,
      });
    });
    DEFAULT_SORT_RULES.forEach((rule) => {
      if (!merged.some((r) => r.id === rule.id)) merged.push({ ...rule });
    });
    nextState.sortRules = merged;
  }

  return nextState;
};

const applyStateValue = (set, key, value) => {
  const defaults = createDefaultStoreState();
  let parsed = value;

  if (value !== null && value !== undefined && isString(value)) {
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = value;
    }
  }

  if (key === 'funds') {
    set({ funds: isArray(parsed) ? parsed : defaults.funds });
    return;
  }
  if (key === 'groups') {
    set({ groups: isArray(parsed) ? parsed : defaults.groups });
    return;
  }
  if (key === 'favorites') {
    set({ favorites: new Set(isArray(parsed) ? parsed : []) });
    return;
  }
  if (key === 'collapsedCodes') {
    set({ collapsedCodes: new Set(isArray(parsed) ? parsed : []) });
    return;
  }
  if (key === 'collapsedTrends') {
    set({ collapsedTrends: new Set(isArray(parsed) ? parsed : []) });
    return;
  }
  if (key === 'collapsedEarnings') {
    set({ collapsedEarnings: new Set(isArray(parsed) ? parsed : []) });
    return;
  }
  if (key === 'refreshMs') {
    const nextMs = Number(parsed);
    set({ refreshMs: Number.isFinite(nextMs) && nextMs >= 5000 ? nextMs : defaults.refreshMs });
    return;
  }
  if (key === 'holdings') {
    set({ holdings: isPlainObject(parsed) ? parsed : defaults.holdings });
    return;
  }
  if (key === 'groupHoldings') {
    set({ groupHoldings: isPlainObject(parsed) ? parsed : defaults.groupHoldings });
    return;
  }
  if (key === 'pendingTrades') {
    set({ pendingTrades: isArray(parsed) ? parsed : defaults.pendingTrades });
    return;
  }
  if (key === 'transactions') {
    set({ transactions: isPlainObject(parsed) ? parsed : defaults.transactions });
    return;
  }
  if (key === 'dcaPlans') {
    set({ dcaPlans: isPlainObject(parsed) ? parsed : defaults.dcaPlans });
    return;
  }
  if (key === 'customSettings') {
    if (value === null || value === undefined) {
      set({
        customSettings: defaults.customSettings,
        pcSortDisplayMode: defaults.pcSortDisplayMode,
        mobileSortDisplayMode: defaults.mobileSortDisplayMode,
        sortRules: defaults.sortRules,
      });
      return;
    }
    const nextSettings = isPlainObject(parsed) ? parsed : defaults.customSettings;
    set({
      customSettings: nextSettings,
      pcSortDisplayMode: defaults.pcSortDisplayMode,
      mobileSortDisplayMode: defaults.mobileSortDisplayMode,
      sortRules: defaults.sortRules,
      ...getSortStateFromSettings(nextSettings),
    });
    return;
  }
  if (key === 'fundDailyEarnings') {
    set({ fundDailyEarnings: normalizeFundDailyEarningsState(parsed) });
    return;
  }
  if (key === 'localSortBy') {
    set({ sortBy: isString(parsed) && parsed ? parsed : defaults.sortBy });
    return;
  }
  if (key === 'localSortOrder') {
    set({ sortOrder: isString(parsed) && parsed ? parsed : defaults.sortOrder });
  }
};

/**
 * 管理 localStorage 数据的 Zustand Store
 */
export const useStorageStore = create((set, get) => ({
  // 云端同步回调，由 Page 组件注入
  onSync: null,
  
  /** 注入同步回调 */
  setOnSync: (callback) => set({ onSync: callback }),
  ...createDefaultStoreState(),

  initFunds: () => {
    if (typeof window !== 'undefined') {
      const saved = get().getItem('funds', []);
      set({ funds: isArray(saved) ? saved : [] });
    }
  },

  initGroups: () => {
    if (typeof window !== 'undefined') {
      set({ groups: get().getItem('groups', []) });
    }
  },

  initFavorites: () => {
    if (typeof window !== 'undefined') {
      const saved = get().getItem('favorites', []);
      set({ favorites: new Set(isArray(saved) ? saved : []) });
    }
  },

  initRefreshMs: () => {
    if (typeof window !== 'undefined') {
      const savedMs = parseInt(get().getItem('refreshMs', 30000), 10);
      set({ refreshMs: Number.isFinite(savedMs) && savedMs >= 5000 ? savedMs : 30000 });
    }
  },

  initHoldings: () => {
    if (typeof window !== 'undefined') {
      set({ holdings: get().getItem('holdings', {}) });
    }
  },

  initGroupHoldings: () => {
    if (typeof window !== 'undefined') {
      set({ groupHoldings: get().getItem('groupHoldings', {}) });
    }
  },

  initPendingTrades: () => {
    if (typeof window !== 'undefined') {
      set({ pendingTrades: get().getItem('pendingTrades', []) });
    }
  },

  initTransactions: () => {
    if (typeof window !== 'undefined') {
      set({ transactions: get().getItem('transactions', {}) });
    }
  },

  initDcaPlans: () => {
    if (typeof window !== 'undefined') {
      set({ dcaPlans: get().getItem('dcaPlans', {}) });
    }
  },

  initCustomSettings: () => {
    if (typeof window !== 'undefined') {
      set({ customSettings: get().getItem('customSettings', {}) });
    }
  },

  initFundDailyEarnings: () => {
    if (typeof window !== 'undefined') {
      set({ fundDailyEarnings: normalizeFundDailyEarningsState(get().getItem('fundDailyEarnings', {})) });
    }
  },

  initCollapsed: () => {
    if (typeof window !== 'undefined') {
      const cc = get().getItem('collapsedCodes', []);
      const ct = get().getItem('collapsedTrends', []);
      const ce = get().getItem('collapsedEarnings', []);
      set({
        collapsedCodes: new Set(Array.isArray(cc) ? cc : []),
        collapsedTrends: new Set(Array.isArray(ct) ? ct : []),
        collapsedEarnings: new Set(Array.isArray(ce) ? ce : []),
      });
    }
  },

  /**
   * 初始化排序相关状态，从 localStorage 恢复持久化的排序偏好
   */
  initSort: () => {
    if (typeof window === 'undefined') return;

    const savedSortBy = get().getItem('localSortBy');
    const savedSortOrder = get().getItem('localSortOrder');

    const nextState = {};
    if (savedSortBy) nextState.sortBy = savedSortBy;
    if (savedSortOrder) nextState.sortOrder = savedSortOrder;

    // 从 customSettings 读取排序规则和展示模式
    try {
      const settings = get().getItem('customSettings', {});
      const legacyRules = get().getItem('localSortRules');
      Object.assign(nextState, getSortStateFromSettings(settings, legacyRules));
    } catch {
      // ignore
    }

    if (Object.keys(nextState).length) set(nextState);
  },

  setFunds: (nextFunds) => {
    const next = typeof nextFunds === 'function' ? nextFunds(get().funds) : nextFunds;
    get().setItem('funds', JSON.stringify(next));
  },

  setGroups: (nextGroups) => {
    const next = typeof nextGroups === 'function' ? nextGroups(get().groups) : nextGroups;
    get().setItem('groups', JSON.stringify(next));
  },

  setFavorites: (nextFavs) => {
    const next = typeof nextFavs === 'function' ? nextFavs(get().favorites) : nextFavs;
    get().setItem('favorites', JSON.stringify(Array.from(next)));
  },

  setCollapsedCodes: (nextVal) => {
    const next = typeof nextVal === 'function' ? nextVal(get().collapsedCodes) : nextVal;
    get().setItem('collapsedCodes', JSON.stringify(Array.from(next)));
  },

  setCollapsedTrends: (nextVal) => {
    const next = typeof nextVal === 'function' ? nextVal(get().collapsedTrends) : nextVal;
    get().setItem('collapsedTrends', JSON.stringify(Array.from(next)));
  },

  setCollapsedEarnings: (nextVal) => {
    const next = typeof nextVal === 'function' ? nextVal(get().collapsedEarnings) : nextVal;
    get().setItem('collapsedEarnings', JSON.stringify(Array.from(next)));
  },

  setRefreshMs: (ms) => {
    get().setItem('refreshMs', String(ms));
  },

  setHoldings: (nextHoldings) => {
    const next = typeof nextHoldings === 'function' ? nextHoldings(get().holdings) : nextHoldings;
    get().setItem('holdings', JSON.stringify(next));
  },

  setGroupHoldings: (nextGroupHoldings) => {
    const next = typeof nextGroupHoldings === 'function' ? nextGroupHoldings(get().groupHoldings) : nextGroupHoldings;
    get().setItem('groupHoldings', JSON.stringify(next));
  },

  setPendingTrades: (nextPendingTrades) => {
    const next = typeof nextPendingTrades === 'function' ? nextPendingTrades(get().pendingTrades) : nextPendingTrades;
    get().setItem('pendingTrades', JSON.stringify(next));
  },

  setTransactions: (nextTransactions) => {
    const next = typeof nextTransactions === 'function' ? nextTransactions(get().transactions) : nextTransactions;
    get().setItem('transactions', JSON.stringify(next));
  },

  setDcaPlans: (nextDcaPlans) => {
    const next = typeof nextDcaPlans === 'function' ? nextDcaPlans(get().dcaPlans) : nextDcaPlans;
    get().setItem('dcaPlans', JSON.stringify(next));
  },

  setCustomSettings: (nextCustomSettings) => {
    const next = typeof nextCustomSettings === 'function' ? nextCustomSettings(get().customSettings) : nextCustomSettings;
    get().setItem('customSettings', JSON.stringify(next));
  },

  setSortBy: (nextSortBy) => {
    const val = typeof nextSortBy === 'function' ? nextSortBy(get().sortBy) : nextSortBy;
    get().setItem('localSortBy', val);
  },

  setSortOrder: (nextSortOrder) => {
    const val = typeof nextSortOrder === 'function' ? nextSortOrder(get().sortOrder) : nextSortOrder;
    get().setItem('localSortOrder', val);
  },

  setPcSortDisplayMode: (nextMode) => {
    const val = typeof nextMode === 'function' ? nextMode(get().pcSortDisplayMode) : nextMode;
    get()._persistSortSettings({ pcSortDisplayMode: val });
  },

  setMobileSortDisplayMode: (nextMode) => {
    const val = typeof nextMode === 'function' ? nextMode(get().mobileSortDisplayMode) : nextMode;
    get()._persistSortSettings({ mobileSortDisplayMode: val });
  },

  setSortRules: (nextRules) => {
    const val = typeof nextRules === 'function' ? nextRules(get().sortRules) : nextRules;
    get()._persistSortSettings({ sortRules: val });
  },

  /**
   * 将排序展示模式和规则合并写入 customSettings 持久化
   * @param {object} patch - 可包含 pcSortDisplayMode / mobileSortDisplayMode / sortRules
   */
  _persistSortSettings: (patch = {}) => {
    try {
      const current = get().customSettings || {};
      const next = {
        ...current,
        localSortRules: patch.sortRules !== undefined ? patch.sortRules : get().sortRules,
        pcLocalSortDisplayMode: patch.pcSortDisplayMode !== undefined ? patch.pcSortDisplayMode : get().pcSortDisplayMode,
        mobileLocalSortDisplayMode: patch.mobileSortDisplayMode !== undefined ? patch.mobileSortDisplayMode : get().mobileSortDisplayMode,
      };
      // 删除旧字段兼容历史数据
      delete next.localSortDisplayMode;
      get().setItem('customSettings', JSON.stringify(next));
    } catch {
      // ignore
    }
  },

  setFundDailyEarnings: (nextFundDailyEarnings) => {
    const next = typeof nextFundDailyEarnings === 'function' ? nextFundDailyEarnings(get().fundDailyEarnings) : nextFundDailyEarnings;
    get().setItem('fundDailyEarnings', JSON.stringify(next));
  },

  applyExternalStorageValue: (key, value) => {
    applyStateValue(set, key, value);
  },

  /**
   * 核心写入方法：同步更新 localStorage 和 Store 状态，并触发同步
   * @param {string} key 
   * @param {string} value JSON 字符串或普通字符串
   */
  setItem: (key, value) => {
    const prevValue = typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;
    
    // 检查内容是否真的发生了变化 (使用 lodash isEqual 进行深对比)
    if (prevValue !== null) {
      try {
        const parsedNew = JSON.parse(value);
        const parsedOld = JSON.parse(prevValue);
        if (isEqual(parsedNew, parsedOld)) return;
      } catch (e) {
        // 非 JSON 或解析失败时使用字符串直接对比
        if (prevValue === value) return;
      }
    }

    // 更新本地存储
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(key, value);
    }

    // 同步更新 Store 状态，确保 UI 响应
    applyStateValue(set, key, value);

    // 触发同步逻辑
    const { onSync } = get();
    if (onSync && SYNC_KEYS.has(key)) {
      // 特殊逻辑：如果是 funds 或 tags，通过签名判断是否真的需要同步
      // 注意：isEqual 已经过滤了完全一致的情况，这里依然保留签名判断
      // 是为了过滤“实质性”无变化的更新（如 jzrq, dwjz 没变，但其他非核心字段变了）
      if (key === 'funds') {
        if (getFundCodesSignature(prevValue) === getFundCodesSignature(value)) {
          return;
        }
      }
      if (key === 'tags') {
        if (getTagsStoreSignature(prevValue) === getTagsStoreSignature(value)) {
          return;
        }
      }
      
      onSync(key, prevValue, value);
    }
  },

  /**
   * 删除 key
   */
  removeItem: (key) => {
    if (typeof window === 'undefined') return;
    const prevValue = window.localStorage.getItem(key);
    window.localStorage.removeItem(key);
    applyStateValue(set, key, null);
    
    const { onSync } = get();
    if (onSync && SYNC_KEYS.has(key)) {
      onSync(key, prevValue, null);
    }
  },

  /**
   * 清空所有存储
   */
  clear: () => {
    if (typeof window === 'undefined') return;
    CLEARABLE_STORAGE_KEYS.forEach((key) => {
      if (window.localStorage.getItem(key) !== null) {
        get().removeItem(key);
      }
    });
    set(createDefaultStoreState());
  },

  /**
   * 获取数据（封装 JSON 解析）
   */
  getItem: (key, defaultValue = null) => {
    if (typeof window === 'undefined') return defaultValue;
    const val = window.localStorage.getItem(key);
    if (val === null) return defaultValue;
    try {
      return JSON.parse(val);
    } catch (e) {
      return val;
    }
  }
}));

/** 非 React 代码中使用的快捷方式 */
export const storageStore = {
  setItem: (key, val) => useStorageStore.getState().setItem(key, val),
  getItem: (key, def) => useStorageStore.getState().getItem(key, def),
  removeItem: (key) => useStorageStore.getState().removeItem(key),
  clear: () => useStorageStore.getState().clear(),
};
