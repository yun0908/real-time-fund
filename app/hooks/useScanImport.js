import { useState, useRef } from 'react';
import { createWorker } from 'tesseract.js';
import { toast as sonnerToast } from 'sonner';
import { parseFundTextWithLLM, fetchFundData, searchFunds } from '../api/fund';
import { recordValuation } from '../lib/valuationTimeseries';
import { useFundFuzzyMatcher } from './useFundFuzzyMatcher';
import { useStorageStore, useUserStore } from '../stores';

const OCR_NOISE_EXACT_LINES = new Set([
  '基金',
  '我的持有',
  '持有收益排序',
  '全部',
  '偏股',
  '偏债',
  '指数',
  '黄金',
  '全球',
  '名称',
  '金额昨日收益',
  '持有收益率',
  '定投',
  '基金市场',
  '机会',
  '自选',
  '持有',
]);

const OCR_NOISE_PARTIALS = [
  '市场解读',
  '去市场看看',
  '更多产品',
  '确认导入基金',
  '拍照识别方案',
  '拍照上传图片识别',
  '未识别到可导入的基金',
  '科技板块高位调整',
  '昨日收益',
  '持有收益',
];

const OCR_FUND_NAME_HINT_RE = /(混合|股票|债券|债基|指数|QDII|ETF|LOF|联接|货币|短债|中短债|配置|量化|制造|医药|消费|成长|价值|红利|科技|互联网|机会)/i;
const OCR_SHARE_CLASS_SUFFIX_RE = /(?:\)|）)?[A-Z]$/i;
const OCR_GENERIC_SUFFIX_ONLY_RE = /^(?:[A-Z]|[\u4e00-\u9fa5]{1,2}(?:\(QDII\))?(?:人民币|美元现汇|美元现钞|美元)?[A-Z]?|混合[A-Z]?|股票(?:\(QDII\))?[A-Z]?|债券[A-Z]?|指数[A-Z]?|联接[A-Z]?|ETF联接[A-Z]?|LOF[A-Z]?|\(QDII\)[A-Z]?|合\(QDII\)[A-Z]?)$/i;

const normalizeOcrLine = (raw) => String(raw ?? '')
  .trim()
  .replace(/\s+/g, '')
  .replace(/[（]/g, '(')
  .replace(/[）]/g, ')')
  .replace(/[，。、“”‘’·•：:；;【】\[\]{}]/g, '');

const normalizeFundNameText = (raw) => normalizeOcrLine(raw).toUpperCase();

const isNumericLikeOcrLine = (line) => /^[+\-]?\d[\d.,%/-]*$/.test(line);

const isPotentialFundNameFragment = (line) => {
  if (!line) return false;
  if (OCR_NOISE_EXACT_LINES.has(line)) return false;
  if (OCR_NOISE_PARTIALS.some((keyword) => line.includes(keyword))) return false;
  if (isNumericLikeOcrLine(line)) return false;
  if (/\d{3,}/.test(line)) return false;

  const hasChinese = /[\u4e00-\u9fa5]/.test(line);
  const hasFundToken = /(QDII|ETF|LOF|[A-Z])/.test(line);
  if (!hasChinese && !hasFundToken) return false;
  if (line.length === 1 && !/[A-Z]/.test(line)) return false;

  return true;
};

const shouldMergeFundNameFragments = (current, next) => {
  if (!isPotentialFundNameFragment(current) || !isPotentialFundNameFragment(next)) return false;
  if (next.length <= 8) return true;
  if (OCR_FUND_NAME_HINT_RE.test(next)) return true;
  if (OCR_SHARE_CLASS_SUFFIX_RE.test(next)) return true;
  return !OCR_FUND_NAME_HINT_RE.test(current);
};

const scoreFundNameCandidate = (name) => {
  let score = 0;
  if (OCR_FUND_NAME_HINT_RE.test(name)) score += 2;
  if (/\(QDII\)|ETF|LOF/i.test(name)) score += 2;
  if (OCR_SHARE_CLASS_SUFFIX_RE.test(name)) score += 1;
  if (name.length >= 6) score += 1;
  if (!/\d/.test(name)) score += 1;
  return score;
};

const stripFundNameVariant = (raw) => normalizeFundNameText(raw)
  .replace(/发起式/g, '')
  .replace(/人民币/g, '')
  .replace(/美元现汇/g, '')
  .replace(/美元现钞/g, '')
  .replace(/美元/g, '')
  .replace(/\(QDII\)/g, '')
  .replace(/[A-Z]$/g, '');

const getFundNameShareSuffix = (raw) => {
  const normalized = normalizeFundNameText(raw);
  const match = normalized.match(/([A-Z])$/);
  return match ? match[1] : '';
};

const getFundNameChinesePrefix = (raw) => {
  const normalized = normalizeFundNameText(raw);
  const match = normalized.match(/[\u4e00-\u9fa5]{2,}/);
  return match ? match[0].slice(0, 2) : '';
};

const isFundNameLikelyPresentInOcr = ({ fundName, fundCode, normalizedOcrText, fallbackFunds }) => {
  if (fundCode && normalizedOcrText.includes(String(fundCode).trim())) return true;
  const normalizedName = normalizeFundNameText(fundName);
  if (!normalizedName) return false;
  if (normalizedOcrText.includes(normalizedName)) return true;

  const targetCore = stripFundNameVariant(fundName);
  const targetShare = getFundNameShareSuffix(fundName);
  if (!targetCore) return false;

  return (fallbackFunds || []).some((item) => {
    const fallbackName = item?.fundName || '';
    const normalizedFallback = normalizeFundNameText(fallbackName);
    if (!normalizedFallback) return false;
    if (normalizedFallback.includes(normalizedName) || normalizedName.includes(normalizedFallback)) return true;

    const fallbackCore = stripFundNameVariant(fallbackName);
    if (!fallbackCore) return false;

    const fallbackShare = getFundNameShareSuffix(fallbackName);
    if (targetShare && fallbackShare && targetShare !== fallbackShare) return false;

    if (targetCore.length < 6 || fallbackCore.length < 6) return false;

    const targetPrefix = getFundNameChinesePrefix(fundName);
    const fallbackPrefix = getFundNameChinesePrefix(fallbackName);
    if (targetPrefix && fallbackPrefix && targetPrefix !== fallbackPrefix) return false;

    return fallbackCore.includes(targetCore) || targetCore.includes(fallbackCore);
  });
};

const hasSameFundNameCandidate = (allFundsData, candidateName) => {
  const normalizedCandidate = normalizeFundNameText(candidateName);
  if (!normalizedCandidate) return false;
  return allFundsData.some((item) => normalizeFundNameText(item?.fundName || '') === normalizedCandidate);
};

const buildFallbackFundsFromOcrText = (text) => {
  const rawLines = String(text ?? '')
    .split(/\r?\n/)
    .map(normalizeOcrLine)
    .filter(Boolean);

  if (!rawLines.length) return [];

  const candidateSet = new Set();
  const addCandidate = (candidate) => {
    const normalized = normalizeOcrLine(candidate);
    if (!normalized || normalized.length < 2 || normalized.length > 40) return;
    if (OCR_NOISE_EXACT_LINES.has(normalized)) return;
    if (OCR_NOISE_PARTIALS.some((keyword) => normalized.includes(keyword))) return;
    if (OCR_GENERIC_SUFFIX_ONLY_RE.test(normalized)) return;
    if (!/[\u4e00-\u9fa5]/.test(normalized)) return;
    if (isNumericLikeOcrLine(normalized)) return;
    if (!OCR_FUND_NAME_HINT_RE.test(normalized) && !OCR_SHARE_CLASS_SUFFIX_RE.test(normalized) && normalized.length < 6) return;
    candidateSet.add(normalized);
  };

  for (let i = 0; i < rawLines.length; i++) {
    const current = rawLines[i];
    if (!isPotentialFundNameFragment(current)) continue;

    const next = rawLines[i + 1];
    if (next && shouldMergeFundNameFragments(current, next)) {
      addCandidate(`${current}${next}`);
      continue;
    }

    addCandidate(current);
  }

  return Array.from(candidateSet)
    .sort((a, b) => scoreFundNameCandidate(b) - scoreFundNameCandidate(a) || b.length - a.length)
    .slice(0, 20)
    .map((fundName) => ({
      fundCode: '',
      fundName,
      holdAmounts: '',
      holdGains: '',
    }));
};

/**
 * OCR 扫描导入基金的完整流程
 *
 * @param {{
 *   setCurrentTab: Function,
 *   setValuationSeries: Function,
 *   setSuccessModal: Function,
 *   showToast: Function,
 *   normalizeCode: Function,
 *   dedupeByCode: Function,
 * }} deps
 */
export function useScanImport({
  setCurrentTab,
  setValuationSeries,
  setSuccessModal,
  showToast,
  normalizeCode,
  dedupeByCode,
}) {
  const user = useUserStore((s) => s.user);
  const funds = useStorageStore((s) => s.funds);
  const favorites = useStorageStore((s) => s.favorites);
  const groups = useStorageStore((s) => s.groups);

  const setFunds = useStorageStore((s) => s.setFunds);
  const setHoldings = useStorageStore((s) => s.setHoldings);
  const setFavorites = useStorageStore((s) => s.setFavorites);
  const setGroups = useStorageStore((s) => s.setGroups);
  const setGroupHoldings = useStorageStore((s) => s.setGroupHoldings);
  const setCollapsedCodes = useStorageStore((s) => s.setCollapsedCodes);
  const setCollapsedTrends = useStorageStore((s) => s.setCollapsedTrends);

  const [scanModalOpen, setScanModalOpen] = useState(false);
  const [scanConfirmModalOpen, setScanConfirmModalOpen] = useState(false);
  const [scannedFunds, setScannedFunds] = useState([]);
  const [selectedScannedCodes, setSelectedScannedCodes] = useState(new Set());
  const [isScanning, setIsScanning] = useState(false);
  const [isScanImporting, setIsScanImporting] = useState(false);
  const [scanImportProgress, setScanImportProgress] = useState({ current: 0, total: 0, success: 0, failed: 0 });
  const [scanProgress, setScanProgress] = useState({ stage: 'ocr', current: 0, total: 0 });
  const [isOcrScan, setIsOcrScan] = useState(false);

  const abortScanRef = useRef(false);
  const fileInputRef = useRef(null);
  const ocrWorkerRef = useRef(null);

  const { resolveFundCodeByFuzzy } = useFundFuzzyMatcher();

  const handleScanClick = () => {
    if (!user?.id) {
      sonnerToast.error('该功能需登录后使用');
      return;
    }
    setScanModalOpen(true);
  };

  const handleScanPick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const cancelScan = () => {
    abortScanRef.current = true;
    setIsScanning(false);
    setScanProgress({ stage: 'ocr', current: 0, total: 0 });
    if (ocrWorkerRef.current) {
      try {
        ocrWorkerRef.current.terminate();
      } catch (e) {}
      ocrWorkerRef.current = null;
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const processFiles = async (files) => {
    if (!files?.length) return;

    setIsScanning(true);
    setScanModalOpen(false);
    abortScanRef.current = false;
    setScanProgress({ stage: 'ocr', current: 0, total: files.length });

    try {
      let worker = ocrWorkerRef.current;
      if (!worker) {
        const cdnBases = [
          'https://fastly.jsdelivr.net/npm',
          'https://cdn.jsdelivr.net/npm',
        ];
        const coreCandidates = [
          'tesseract-core-simd-lstm.wasm.js',
          'tesseract-core-lstm.wasm.js',
        ];
        let lastErr = null;
        for (const base of cdnBases) {
          for (const coreFile of coreCandidates) {
            try {
              worker = await createWorker('chi_sim+eng', 1, {
                workerPath: `${base}/tesseract.js@v5.1.1/dist/worker.min.js`,
                corePath: `${base}/tesseract.js-core@v5.1.1/${coreFile}`,
              });
              lastErr = null;
              break;
            } catch (e) {
              lastErr = e;
            }
          }
          if (!lastErr) break;
        }
        if (lastErr) throw lastErr;
        ocrWorkerRef.current = worker;
      }

      const recognizeWithTimeout = async (file, ms) => {
        let timer = null;
        const timeout = new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('OCR_TIMEOUT')), ms);
        });
        try {
          return await Promise.race([worker.recognize(file), timeout]);
        } finally {
          if (timer) clearTimeout(timer);
        }
      };

      const searchFundsWithTimeout = async (val, ms) => {
        let timer = null;
        const timeout = new Promise((resolve) => {
          timer = setTimeout(() => resolve([]), ms);
        });
        try {
          return await Promise.race([searchFunds(val), timeout]);
        } catch (e) {
          return [];
        } finally {
          if (timer) clearTimeout(timer);
        }
      };

      const allFundsData = [];
      const addedFundCodes = new Set();

      for (let i = 0; i < files.length; i++) {
        if (abortScanRef.current) break;

        const f = files[i];
        setScanProgress(prev => ({ ...prev, current: i + 1 }));

        let text = '';
        try {
          const res = await recognizeWithTimeout(f, 30000);
          text = res?.data?.text || '';
        } catch (e) {
          if (String(e?.message || '').includes('OCR_TIMEOUT')) {
            if (worker) {
              try { await worker.terminate(); } catch (err) {}
              ocrWorkerRef.current = null;
            }
            throw e;
          }
          text = '';
        }

        const fundsResString = await parseFundTextWithLLM(text);
        let fundsRes = null;
        try {
          fundsRes = JSON.parse(fundsResString);
        } catch (e) {
          console.error(e);
        }

        const normalizedOcrText = normalizeFundNameText(text);
        const fallbackFunds = buildFallbackFundsFromOcrText(text);

        if (Array.isArray(fundsRes) && fundsRes.length > 0) {
          fundsRes.forEach((fund) => {
            const code = fund.fundCode || '';
            const name = (fund.fundName || '').trim();
            const isLikelyPresent = isFundNameLikelyPresentInOcr({
              fundName: name,
              fundCode: code,
              normalizedOcrText,
              fallbackFunds,
            });

            if (!isLikelyPresent) return;

            if (code && !addedFundCodes.has(code)) {
              addedFundCodes.add(code);
              allFundsData.push({ fundCode: code, fundName: name, holdAmounts: fund.holdAmounts || '', holdGains: fund.holdGains || '' });
            } else if (!code && name && !hasSameFundNameCandidate(allFundsData, name)) {
              allFundsData.push({ fundCode: '', fundName: name, holdAmounts: fund.holdAmounts || '', holdGains: fund.holdGains || '' });
            }
          });
        }

        // 始终补充一轮 OCR 本地兜底，避免云端仅识别出部分基金时遗漏剩余名称
        fallbackFunds.forEach((fund) => {
          if (fund?.fundName && !hasSameFundNameCandidate(allFundsData, fund.fundName)) {
            allFundsData.push(fund);
          }
        });
      }

      if (abortScanRef.current) return;

      // 处理没有基金代码但有名称的情况，通过名称搜索基金代码
      const fundsWithoutCode = allFundsData.filter(f => !f.fundCode && f.fundName);
      if (fundsWithoutCode.length > 0) {
        setScanProgress({ stage: 'verify', current: 0, total: fundsWithoutCode.length });
        for (let i = 0; i < fundsWithoutCode.length; i++) {
          if (abortScanRef.current) break;
          const fundItem = fundsWithoutCode[i];
          setScanProgress(prev => ({ ...prev, current: i + 1 }));
          try {
            const list = await searchFundsWithTimeout(fundItem.fundName, 8000);
            if (Array.isArray(list) && list.length === 1) {
              const found = list[0];
              if (found && found.CODE && !addedFundCodes.has(found.CODE)) {
                addedFundCodes.add(found.CODE);
                fundItem.fundCode = found.CODE;
              }
            } else {
              try {
                const fuzzyCode = await resolveFundCodeByFuzzy(fundItem.fundName);
                if (fuzzyCode && !addedFundCodes.has(fuzzyCode)) {
                  addedFundCodes.add(fuzzyCode);
                  fundItem.fundCode = fuzzyCode;
                }
              } catch (e) {}
            }
          } catch (e) {}
        }
      }

      const validFunds = allFundsData.filter(f => f.fundCode);
      const codes = validFunds.map(f => f.fundCode).sort();
      setScanProgress({ stage: 'verify', current: 0, total: codes.length });

      const existingCodes = new Set(funds.map(f => f.code));
      const results = [];
      for (let i = 0; i < codes.length; i++) {
        if (abortScanRef.current) break;
        const code = codes[i];
        const fundInfo = validFunds.find(f => f.fundCode === code);
        setScanProgress(prev => ({ ...prev, current: i + 1 }));

        let found = null;
        try {
          const list = await searchFundsWithTimeout(code, 8000);
          found = Array.isArray(list) ? list.find(d => d.CODE === code) : null;
        } catch (e) {
          found = null;
        }

        const alreadyAdded = existingCodes.has(code);
        const ok = !!found && !alreadyAdded;
        results.push({
          code,
          name: found ? (found.NAME || found.SHORTNAME || '') : (fundInfo?.fundName || ''),
          status: alreadyAdded ? 'added' : (ok ? 'ok' : 'invalid'),
          holdAmounts: fundInfo?.holdAmounts || '',
          holdGains: fundInfo?.holdGains || '',
        });
      }

      if (abortScanRef.current) return;

      setScannedFunds(results);
      setSelectedScannedCodes(new Set(results.filter(r => r.status === 'ok').map(r => r.code)));
      setIsOcrScan(true);
      setScanConfirmModalOpen(true);
    } catch (err) {
      if (!abortScanRef.current) {
        console.error('OCR Error:', err);
        showToast('图片识别失败，请重试或更换更清晰的截图', 'error');
      }
    } finally {
      setIsScanning(false);
      setScanProgress({ stage: 'ocr', current: 0, total: 0 });
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFilesUpload = (event) => {
    processFiles(Array.from(event.target.files || []));
  };

  const handleFilesDrop = (files) => {
    processFiles(files);
  };

  const toggleScannedCode = (code) => {
    setSelectedScannedCodes(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const confirmScanImport = async (targetGroupId = 'all', expandAfterAdd = true) => {
    const parseAmount = (val) => {
      if (!val && val !== 0) return null;
      const num = parseFloat(String(val).replace(/,/g, ''));
      return isNaN(num) ? null : num;
    };

    const rawCodes = Array.from(selectedScannedCodes);
    const targetExists = (code) => {
      if (!code) return false;
      if (targetGroupId === 'all') return funds.some((f) => f.code === code);
      if (targetGroupId === 'fav') return favorites?.has?.(code);
      const g = groups.find((x) => x.id === targetGroupId);
      return !!(g && Array.isArray(g.codes) && g.codes.includes(code));
    };

    const codes = rawCodes.filter((c) => {
      const exists = targetExists(c);
      const scannedFund = scannedFunds.find(f => f.code === c);
      const holdAmounts = parseAmount(scannedFund?.holdAmounts);
      const holdGains = parseAmount(scannedFund?.holdGains);
      const hasHoldingData = holdAmounts !== null && holdGains !== null;
      return !exists || hasHoldingData;
    });

    if (codes.length === 0) {
      showToast('所选基金已在目标分组中', 'info');
      return;
    }
    setScanConfirmModalOpen(false);
    setIsScanImporting(true);
    setScanImportProgress({ current: 0, total: codes.length, success: 0, failed: 0 });

    try {
      const newFunds = [];
      const newHoldings = {};
      let successCount = 0;
      let failedCount = 0;

      for (let i = 0; i < codes.length; i++) {
        const code = codes[i];
        setScanImportProgress(prev => ({ ...prev, current: i + 1 }));

        const existed = funds.some(existing => existing.code === code);
        try {
          const data = existed ? (funds.find((f) => f.code === code) || null) : await fetchFundData(code);
          if (!existed && data) newFunds.push(data);

          const scannedFund = scannedFunds.find(f => f.code === code);
          const holdAmounts = parseAmount(scannedFund?.holdAmounts);
          const holdGains = parseAmount(scannedFund?.holdGains);
          const dwjz = data?.dwjz || data?.gsz || 0;

          if (holdAmounts !== null && dwjz > 0) {
            const share = holdAmounts / dwjz;
            const profit = holdGains !== null ? holdGains : 0;
            const principal = holdAmounts - profit;
            const cost = share > 0 ? principal / share : 0;
            newHoldings[code] = {
              share: Number(share.toFixed(2)),
              cost: Number(cost.toFixed(4)),
            };
          }

          successCount++;
          setScanImportProgress(prev => ({ ...prev, success: prev.success + 1 }));
        } catch (e) {
          failedCount++;
          setScanImportProgress(prev => ({ ...prev, failed: prev.failed + 1 }));
        }
      }

      const newCodesSet = new Set(newFunds.map((f) => f.code));
      const allSelectedSet = new Set(codes);

      if (newFunds.length > 0) {
        setFunds(prev => dedupeByCode([...newFunds, ...prev]));

        if (Object.keys(newHoldings).length > 0) {
          if (targetGroupId !== 'all' && targetGroupId !== 'fav') {
            setGroupHoldings(prev => {
              const bucket = prev[targetGroupId] ? { ...prev[targetGroupId] } : {};
              return { ...prev, [targetGroupId]: { ...bucket, ...newHoldings } };
            });
          } else {
            setHoldings(prev => ({ ...prev, ...newHoldings }));
          }
        }

        const nextSeries = {};
        newFunds.forEach(u => {
          if (u?.code != null && !u.noValuation && Number.isFinite(Number(u.gsz))) {
            nextSeries[u.code] = recordValuation(u.code, { gsz: u.gsz, gztime: u.gztime });
          }
        });
        if (Object.keys(nextSeries).length > 0) setValuationSeries(prev => ({ ...prev, ...nextSeries }));

        if (!expandAfterAdd) {
          setCollapsedCodes(prev => {
            const next = new Set(prev);
            newCodesSet.forEach((code) => next.add(code));
            return next;
          });
          setCollapsedTrends(prev => {
            const next = new Set(prev);
            newCodesSet.forEach((code) => next.add(code));
            return next;
          });
        }
      }

      if (targetGroupId === 'fav') {
        setFavorites(prev => {
          const next = new Set(prev);
          codes.map(normalizeCode).filter(Boolean).forEach(code => next.add(code));
          return next;
        });
        setCurrentTab('fav');
      } else if (targetGroupId && targetGroupId !== 'all') {
        setGroups(prev => prev.map(g => {
          if (g.id === targetGroupId) {
            return { ...g, codes: Array.from(new Set([...(g.codes || []), ...codes])) };
          }
          return g;
        }));
        setCurrentTab(targetGroupId);
      } else {
        setCurrentTab('all');
      }

      if (successCount > 0) {
        setSuccessModal({ open: true, message: `成功导入 ${successCount} 个基金` });
      } else if (allSelectedSet.size > 0 && failedCount === 0) {
        setSuccessModal({ open: true, message: '所选基金已在目标分组中' });
      } else {
        showToast('未能导入任何基金', 'info');
      }
    } catch (e) {
      showToast('导入失败', 'error');
    } finally {
      setIsScanImporting(false);
      setScanImportProgress({ current: 0, total: 0, success: 0, failed: 0 });
      setScannedFunds([]);
      setSelectedScannedCodes(new Set());
    }
  };

  return {
    // 状态
    scanModalOpen, setScanModalOpen,
    scanConfirmModalOpen, setScanConfirmModalOpen,
    scannedFunds, setScannedFunds,
    selectedScannedCodes, setSelectedScannedCodes,
    isScanning,
    isScanImporting,
    scanImportProgress,
    scanProgress,
    isOcrScan, setIsOcrScan,
    fileInputRef,
    // 操作
    handleScanClick,
    handleScanPick,
    cancelScan,
    handleFilesUpload,
    handleFilesDrop,
    toggleScannedCode,
    confirmScanImport,
  };
}
