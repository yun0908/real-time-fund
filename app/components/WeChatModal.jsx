'use client';

import { motion } from 'framer-motion';
import { CloseIcon } from './Icons';

export default function WeChatModal({ onClose }) {
  return (
    <motion.div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="社群入口"
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{ zIndex: 10002 }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="glass card modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '360px', padding: '24px' }}
      >
        <div className="title" style={{ marginBottom: 20, justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span>💬 社群入口</span>
          </div>
          <button className="icon-button" onClick={onClose} style={{ border: 'none', background: 'transparent' }}>
            <CloseIcon width="20" height="20" />
          </button>
        </div>
        <div
          className="trade-pending-alert"
        >
          <span>当前版本未配置社群二维码或联系入口。</span>
        </div>
        <p className="muted" style={{ textAlign: 'center', marginTop: 16, fontSize: '14px' }}>
          如需启用，请替换为你自己的社群二维码或邀请链接。
        </p>
      </motion.div>
    </motion.div>
  );
}
