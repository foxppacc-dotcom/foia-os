import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Upload, FileText, Sparkles, ArrowRight, FileUp } from 'lucide-react';

export default function AIIntake() {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [fileLoading, setFileLoading] = useState(false);

  const handleSubmit = async () => {
    if (!text.trim()) return;
    setLoading(true);
    try {
      const res = await api.intakeText({ text, title: title || undefined });
      setResult(res);
    } catch (err) {
      setResult({ error: err.message });
    }
    setLoading(false);
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileLoading(true);
    try {
      const res = await api.intakeUpload(file);
      setResult(res);
    } catch (err) {
      setResult({ error: err.message });
    }
    setFileLoading(false);
  };

  const inputStyle = {
    background: 'var(--bg-primary)',
    border: '1px solid var(--border)',
    color: 'var(--text-primary)',
  };
  const inputFocusStyle = { borderColor: 'var(--accent)' };

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center gap-3">
        <Sparkles className="w-6 h-6" style={{ color: 'var(--accent)' }} />
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>AI Intake — استقبال ذكي</h1>
      </div>

      {/* Input area */}
      <div className="rounded-2xl p-6" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
        <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--accent)' }}>إدخال نص أو لصق مستند</h2>
        
        <div className="space-y-3">
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="عنوان القضية (اختياري)"
            className="w-full px-4 py-3 rounded-xl transition-all"
            style={inputStyle}
            onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
            onBlur={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}
          />
          
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="الصق نص طلب FOIA أو وصف القضية هنا..."
            rows={8}
            className="w-full px-4 py-3 rounded-xl transition-all resize-y font-mono text-sm"
            style={{ ...inputStyle, minHeight: '160px' }}
            onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
            onBlur={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}
          />

          <div className="flex items-center justify-between">
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{text.length} حرف</p>
            <button
              onClick={handleSubmit}
              disabled={loading || !text.trim()}
              className="flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm transition-all active:scale-[0.97] disabled:opacity-40"
              style={{ background: 'var(--accent)', color: 'var(--text-inverse)' }}
            >
              {loading ? (
                <div className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--text-inverse)', borderTopColor: 'transparent' }} />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              {loading ? 'جارٍ المعالجة...' : 'معالجة ذكية'}
            </button>
          </div>
        </div>
      </div>

      {/* Result */}
      {result && (
        <div className="rounded-2xl p-5 animate-slideUp" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
          <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--accent)' }}>النتيجة</h2>
          {result.error ? (
            <p className="text-xs" style={{ color: 'var(--danger)' }}>{result.error}</p>
          ) : (
            <div className="space-y-2">
              {result.case_id && (
                <div className="flex items-center gap-2">
                  <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>تم إنشاء القضية</span>
                  <button onClick={() => navigate(`/cases/${result.case_id}`)} 
                    className="flex items-center gap-1 text-xs font-semibold hover:underline"
                    style={{ color: 'var(--accent)' }}>
                    #{result.case_id} <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              )}
              {result.summary && (
                <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{result.summary}</p>
              )}
              {result.classification && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {Object.entries(result.classification).map(([key, val]) => (
                    <span key={key} className="px-2 py-0.5 rounded text-[10px]" 
                      style={{ background: 'var(--accent-subtle)', color: 'var(--accent)' }}>
                      {key}: {String(val)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* OR Divider */}
      <div className="flex items-center gap-3">
        <div className="flex-1" style={{ height: '1px', background: 'var(--border)' }} />
        <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>أو</span>
        <div className="flex-1" style={{ height: '1px', background: 'var(--border)' }} />
      </div>

      {/* File Upload */}
      <div className="rounded-2xl p-6" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
        <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--accent)' }}>رفع مستند</h2>
        <label className="flex flex-col items-center justify-center p-6 rounded-xl cursor-pointer transition-all hover:-translate-y-0.5"
          style={{ background: 'var(--bg-primary)', border: '2px dashed var(--border)' }}>
          <FileUp className="w-8 h-8 mb-2" style={{ color: 'var(--text-muted)' }} />
          <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
            {fileLoading ? 'جاري الرفع...' : 'اضغط لرفع ملف'}
          </p>
          <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>PDF, DOCX, TXT — 10MB كحد أقصى</p>
          <input type="file" onChange={handleFileUpload} accept=".pdf,.docx,.txt" className="hidden" disabled={fileLoading} />
        </label>
      </div>
    </div>
  );
}
