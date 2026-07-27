import { ShieldCheck, Globe, Video, HelpCircle } from 'lucide-react';

const RELIABILITY = {
  official: { label: 'رسمي', color: '#10B981', icon: ShieldCheck },
  verified: { label: 'موثّق', color: '#3B82F6', icon: ShieldCheck },
  public: { label: 'عام', color: '#F59E0B', icon: Globe },
  media: { label: 'إعلامي', color: '#8B5CF6', icon: Video },
  unknown: { label: 'غير معروف', color: '#6B7280', icon: HelpCircle },
};

import { memo } from 'react';
export default memo(function SourceBadge({ reliability = 'unknown', importance = 'medium' }) {
  const r = RELIABILITY[reliability] || RELIABILITY.unknown;
  const impColors = { critical: '#EF4444', high: '#F59E0B', medium: '#3B82F6', low: '#6B7280' };
  const impLabels = { critical: 'حاسم', high: 'عالي', medium: 'متوسط', low: 'منخفض' };

  return (
    <div className="flex items-center gap-1.5">
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium"
        style={{ background: r.color + '15', color: r.color }}>
        <r.icon className="w-3 h-3" />
        {r.label}
      </span>
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium"
        style={{ background: (impColors[importance] || impColors.medium) + '15', color: impColors[importance] || impColors.medium }}>
        {impLabels[importance] || impLabels.medium}
      </span>
    </div>
  );
});
