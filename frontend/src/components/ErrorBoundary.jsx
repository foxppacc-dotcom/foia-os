import { Component } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { api } from '../api';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] Caught:', error, info?.componentStack);
    // Log to backend for centralized monitoring
    try {
      api.post('/activity/log', {
        action_type: 'error',
        target_type: 'app',
        target_title: `ErrorBoundary: ${error?.message || 'Unknown error'}`,
        details: { stack: error?.stack, componentStack: info?.componentStack },
      }).catch(() => {});
    } catch {}
    // Notify monitoring endpoint if available
    try {
      const payload = { error: error?.message, stack: error?.stack, url: window.location.href };
      navigator.sendBeacon?.('/api/errors', new Blob([JSON.stringify(payload)], { type: 'application/json' }));
    } catch {}
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="min-h-[40vh] flex items-center justify-center p-8">
          <div className="text-center max-w-md">
            <AlertTriangle className="w-12 h-12 mx-auto mb-4" style={{ color: 'var(--danger)' }} />
            <h2 className="text-lg font-bold mb-2" style={{ color: 'var(--text-primary)' }}>حدث خطأ غير متوقع</h2>
            <p className="text-sm mb-1" style={{ color: 'var(--text-muted)' }}>
              {this.state.error?.message || 'An unexpected error occurred'}
            </p>
            <p className="text-xs mb-6" style={{ color: 'var(--text-muted)' }}>تم تسجيل الخطأ تلقائياً</p>
            <button
              onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm transition-all"
              style={{ background: 'var(--accent)', color: 'var(--text-inverse)' }}
            >
              <RefreshCw className="w-4 h-4" /> إعادة تحميل
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
