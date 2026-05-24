'use client';

import { motion } from 'framer-motion';
import { CloseIcon } from './Icons';
import { DonateTabs } from './Common';

export default function DonateModal({ onClose }) {
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="赞助" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="glass card modal"
        style={{ maxWidth: '360px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="title" style={{ marginBottom: 20, justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span>☕ 赞助项目</span>
          </div>
          <button className="icon-button" onClick={onClose} style={{ border: 'none', background: 'transparent' }}>
            <CloseIcon width="20" height="20" />
          </button>
        </div>

        <div style={{ marginBottom: 20 }}>
          <DonateTabs />
        </div>

        <div className="muted" style={{ fontSize: '12px', textAlign: 'center', lineHeight: 1.5 }}>
          感谢你的支持。当前赞助入口已改为占位提示，可按需配置为你自己的收款渠道。
        </div>
      </motion.div>
    </div>
  );
}
