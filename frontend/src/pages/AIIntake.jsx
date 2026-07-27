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

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center gap-3">
        <Sparkles className="w-6 h-6 text-[#D4A843]" />
        <h1 className="text-xl font-bold text-white">AI Intake — استقبال ذكي</h1>
      </div>

      {/* Input area */}
      <div className="bg-[rgba(17,17,34,0.6)] backdrop-blur-xl border border-[rgba(255,255,255,0.06)] rounded-2xl p-6">
        <h2 className="text-sm font-semibold text-[#D4A843] mb-4">إدخال نص أو لصق مستند</h2>
        
        <div className="space-y-3">
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="عنوان القضية (اختياري)"
            className="w-full px-4 py-3 rounded-xl bg-[#13131A] border border-[#1F1F2A] text-white placeholder-gray-500 focus:outline-none focus:border-[#D4A843] transition-all"
          />
          
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="الصق نص طلب FOIA أو وصف القضية هنا..."
            rows={8}
            className="w-full px-4 py-3 rounded-xl bg-[#13131A] border border-[#1F1F2A] text-white placeholder-gray-500 focus:outline-none focus:border-[#D4A843] transition-all resize-y font-mono text-sm"
          />

          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-600">{text.length} حرف</p>
            <button
              onClick={handleSubmit}
              disabled={loading || !text.trim()}
              className="flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm bg-gradient-to-r from-[#D4A843] to-[#e4b84a] text-[#0A0A0F] hover:shadow-lg hover:shadow-[#D4A843]/30 active:scale-[0.97] transition-all disabled:opacity-40"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-[#0A0A0F] border-t-transparent rounded-full animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              {loading ? 'جارٍ المعالجة...' : 'معالجة ذكية'}
            </button>
          </div>
        </div>
      </div>

      {/* File upload */}
      <div className="bg-[rgba(17,17,34,0.6)] backdrop-blur-xl border border-[rgba(255,255,255,0.06)] rounded-2xl p-6">
        <h2 className="text-sm font-semibold text-[#D4A843] mb-4">رفع ملف (PDF, DOCX, صور)</h2>
        <label className="flex flex-col items-center justify-center py-8 rounded-xl border-2 border-dashed border-[#1F1F2A] hover:border-[#D4A843]/40 cursor-pointer transition-all">
          {fileLoading ? (
            <div className="w-8 h-8 border-2 border-[#D4A843] border-t-transparent rounded-full animate-spin" />
          ) : (
            <>
              <FileUp className="w-8 h-8 text-gray-600 mb-2" />
              <p className="text-sm text-gray-500">اختر ملف أو اسحبه هنا</p>
              <p className="text-xs text-gray-600 mt-1">PDF, DOCX, JPG, PNG (حد أقصى 50MB)</p>
            </>
          )}
          <input type="file" className="hidden" onChange={handleFileUpload} accept=".pdf,.docx,.txt,.png,.jpg,.jpeg" disabled={fileLoading} />
        </label>
      </div>

      {/* Result */}
      {result && (
        <div className="bg-[rgba(17,17,34,0.6)] backdrop-blur-xl border border-[rgba(255,255,255,0.06)] rounded-2xl p-6 animate-slideUp">
          {result.error ? (
            <div className="text-center py-6">
              <p className="text-[#EF4444] text-sm">{result.error}</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-[#10B981]" />
                  <h3 className="text-sm font-semibold text-white">نتيجة المعالجة</h3>
                </div>
                <button
                  onClick={() => navigate(`/cases/${result.case_id}`)}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl font-medium text-xs bg-[#10B981]/10 text-[#10B981] border border-[#10B981]/20 hover:bg-[#10B981]/20 transition-all"
                >
                  فتح القضية
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Agencies */}
                <div className="p-4 rounded-xl bg-[#0A0A0F]">
                  <p className="text-xs text-gray-500 mb-2">الجهات المكتشفة</p>
                  {result.metadata?.agencies?.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {result.metadata.agencies.map((a, i) => (
                        <span key={i} className="px-2 py-1 rounded-md text-[11px] bg-[#D4A843]/10 text-[#D4A843]">{a}</span>
                      ))}
                    </div>
                  ) : <p className="text-sm text-gray-600">—</p>}
                </div>

                {/* Dates */}
                <div className="p-4 rounded-xl bg-[#0A0A0F]">
                  <p className="text-xs text-gray-500 mb-2">التواريخ المكتشفة</p>
                  {result.metadata?.dates?.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {result.metadata.dates.map((d, i) => (
                        <span key={i} className="px-2 py-1 rounded-md text-[11px] bg-[#3B82F6]/10 text-[#3B82F6]">{d}</span>
                      ))}
                    </div>
                  ) : <p className="text-sm text-gray-600">—</p>}
                </div>

                {/* Case Numbers */}
                <div className="p-4 rounded-xl bg-[#0A0A0F]">
                  <p className="text-xs text-gray-500 mb-2">أرقام القضايا</p>
                  {result.metadata?.case_numbers?.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {result.metadata.case_numbers.map((c, i) => (
                        <span key={i} className="px-2 py-1 rounded-md text-[11px] bg-[#8B5CF6]/10 text-[#8B5CF6]">{c}</span>
                      ))}
                    </div>
                  ) : <p className="text-sm text-gray-600">—</p>}
                </div>

                {/* Evidence */}
                <div className="p-4 rounded-xl bg-[#0A0A0F]">
                  <p className="text-xs text-gray-500 mb-2">الأدلة المكتشفة</p>
                  {result.metadata?.evidence?.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {result.metadata.evidence.map((e, i) => (
                        <span key={i} className="px-2 py-1 rounded-md text-[11px] bg-[#10B981]/10 text-[#10B981]">{e}</span>
                      ))}
                    </div>
                  ) : <p className="text-sm text-gray-600">—</p>}
                </div>
              </div>

              {/* Summary */}
              <div className="p-4 rounded-xl bg-[#0A0A0F]">
                <p className="text-xs text-gray-500 mb-2">ملخص تلقائي</p>
                <p className="text-sm text-white">{result.metadata?.summary || '—'}</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
