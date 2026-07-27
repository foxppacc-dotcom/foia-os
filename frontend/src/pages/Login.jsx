import { useState, useRef, useEffect } from 'react';
import { Mail, Lock, Eye, EyeOff, ShieldCheck, Zap, LineChart, FileText, AlertCircle } from 'lucide-react';
import AppCard from '../components/ds/AppCard';
import AppInput from '../components/ds/AppInput';
import AppButton from '../components/ds/AppButton';
import AppSpinner from '../components/ds/AppSpinner';
import { api } from '../api';

const highlights = [
  { icon: ShieldCheck, text: 'تتبّع كامل لسجلات FOIA من الاستلام حتى الإغلاق' },
  { icon: Zap, text: 'تصنيف تلقائي وسير عمل موحّد لكل الجهات' },
  { icon: LineChart, text: 'لوحة تحكم مباشرة بأداء الفريق والقضايا' },
];

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [timeout, setTimeout_] = useState(false);
  const emailRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => { emailRef.current?.focus(); }, []);

  useEffect(() => {
    if (loading) {
      timerRef.current = setTimeout(() => setTimeout_(true), 30000);
    } else {
      setTimeout_(false);
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [loading]);

  const validate = () => {
    if (!email.trim()) { setError('الرجاء إدخال البريد الإلكتروني'); return false; }
    if (!email.includes('@')) { setError('صيغة البريد الإلكتروني غير صحيحة'); return false; }
    if (!password) { setError('الرجاء إدخال كلمة المرور'); return false; }
    if (password.length < 4) { setError('كلمة المرور يجب أن تكون 4 أحرف على الأقل'); return false; }
    return true;
  };

  const handleSubmit = async () => {
    setError('');
    if (!validate()) return;
    setLoading(true);
    try {
      const res = await api.login(email.trim(), password);
      if (res?.token) {
        localStorage.setItem('foia_token', res.token);
        api.setToken(res.token);
        onLogin(res.user);
      } else {
        setError(res?.error || res?.message || 'بيانات الدخول غير صحيحة');
      }
    } catch (err) {
      setError('تعذر الاتصال بالخادم. تحقق من اتصال الإنترنت وحاول مجدداً');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex" style={{ background: 'var(--ds-bg-primary)' }}>
      {/* Form side */}
      <div className="flex-1 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-sm ds-animate-slideUp">
          {/* Logo */}
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-5"
            style={{ background: 'var(--ds-accent)', boxShadow: '0 8px 24px rgba(212,168,67,0.25)' }}>
            <FileText className="w-6 h-6" style={{ color: 'var(--ds-text-inverse)' }} />
          </div>

          <h1 className="text-2xl sm:text-3xl font-bold mb-1" style={{ color: 'var(--ds-text-primary)', letterSpacing: '-0.02em' }}>تسجيل الدخول</h1>
          <p className="text-sm mb-6" style={{ color: 'var(--ds-text-muted)' }}>ادخل بياناتك للوصول إلى نظام FOIA OS</p>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2.5 mb-4 p-3.5 rounded-xl ds-animate-slideDown text-sm"
              style={{ background: 'var(--ds-danger-subtle)', color: 'var(--ds-danger-text)' }} role="alert">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Timeout warning */}
          {timeout && (
            <div className="flex items-start gap-2.5 mb-4 p-3.5 rounded-xl ds-animate-slideDown text-sm"
              style={{ background: 'var(--ds-warning-subtle)', color: 'var(--ds-warning-text)' }} role="alert">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>استغرقت عملية تسجيل الدخول وقتاً طويلاً. تحقق من اتصالك ثم حاول مجدداً.</span>
            </div>
          )}

          {/* Form */}
          <div className="space-y-4" onKeyDown={e => { if (e.key === 'Enter' && !loading) handleSubmit(); }}>
            <AppInput
              ref={emailRef}
              label="البريد الإلكتروني"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="name@example.com"
              icon={<Mail className="w-4 h-4" />}
              autoComplete="email"
              aria-invalid={error && !email ? 'true' : 'false'}
              aria-describedby={error ? 'login-error' : undefined}
            />
            <AppInput
              label="كلمة المرور"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              icon={<Lock className="w-4 h-4" />}
              autoComplete="current-password"
              aria-invalid={error && !password ? 'true' : 'false'}
              style={{ paddingLeft: '40px' }}
              suffix={
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 left-2 flex items-center ds-focus-ring rounded"
                  aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                  tabIndex={-1}
                  style={{ color: 'var(--ds-text-muted)' }}>
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              }
            />
            <AppButton loading={loading} fullWidth size="lg" onClick={handleSubmit}>
              دخول
            </AppButton>
          </div>
        </div>
      </div>

      {/* Brand side */}
      <div className="hidden lg:flex flex-1 items-center justify-center relative overflow-hidden p-12"
        style={{ background: 'linear-gradient(160deg, var(--ds-bg-secondary), var(--ds-bg-primary))', borderRight: '1px solid var(--ds-border)' }}>
        <div className="absolute inset-0 opacity-40"
          style={{ backgroundImage: 'radial-gradient(circle at 30% 20%, rgba(212,168,67,0.14), transparent 55%)' }} />
        <div className="relative max-w-md">
          <h2 className="text-3xl font-bold mb-4 leading-tight ds-animate-slideUp"
            style={{ color: 'var(--ds-text-primary)', letterSpacing: '-0.02em' }}>
            نظام تشغيل متكامل لطلبات <span style={{ color: 'var(--ds-accent)' }}>FOIA</span>
          </h2>
          <p className="text-sm mb-8 ds-animate-fadeIn" style={{ color: 'var(--ds-text-muted)' }}>
            من استقبال الطلب إلى استلام السجلات — كل شيء في مكان واحد، لفريقك بالكامل.
          </p>
          <div className="space-y-4 ds-animate-slideUp" style={{ animationDelay: '100ms' }}>
            {highlights.map((h, i) => (
              <div key={i} className="flex items-center gap-3.5 p-4 rounded-2xl border ds-hover-lift"
                style={{ background: 'var(--ds-bg-secondary)', borderColor: 'var(--ds-border)' }}>
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--ds-accent-subtle)' }}>
                  <h.icon className="w-4.5 h-4.5" style={{ color: 'var(--ds-accent)' }} />
                </div>
                <p className="text-sm" style={{ color: 'var(--ds-text-secondary)' }}>{h.text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
