import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

// A plain <input> for secrets with the eye button that shows/hides what was typed.
// For the styled <Input> (components/ui/Input.jsx) just pass type="password" -- it has the
// same eye built in; this one is for the pages that style their own raw <input>.
export default function PasswordInput({ wrapperClassName = '', className = '', style, ...rest }) {
  const [show, setShow] = useState(false);
  return (
    <div className={`relative ${wrapperClassName}`}>
      <input {...rest} type={show ? 'text' : 'password'} className={`w-full ${className}`} style={{ ...style, paddingLeft: '40px' }} />
      <button type="button" onClick={() => setShow(s => !s)} tabIndex={-1}
        aria-label={show ? 'إخفاء' : 'إظهار'} title={show ? 'إخفاء' : 'إظهار'}
        className="absolute top-1/2 -translate-y-1/2 left-3 p-1 rounded" style={{ color: 'var(--text-muted)' }}>
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}
