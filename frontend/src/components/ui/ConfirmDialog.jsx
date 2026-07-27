import { AlertTriangle } from 'lucide-react';
import Modal from './Modal';
import Button from './Button';

export default function ConfirmDialog({ open, onClose, onConfirm, title = 'تأكيد', message, confirmLabel = 'تأكيد', danger = true, loading = false }) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="flex items-start gap-3 mb-5">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: danger ? 'var(--danger-subtle)' : 'var(--accent-subtle)' }}>
          <AlertTriangle className="w-4.5 h-4.5" style={{ color: danger ? 'var(--danger)' : 'var(--accent)' }} />
        </div>
        <p className="text-sm pt-1.5" style={{ color: 'var(--text-secondary)' }}>{message}</p>
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onClose}>إلغاء</Button>
        <Button className="flex-1" loading={loading} style={danger ? { background: 'var(--danger)', color: 'white' } : undefined} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
