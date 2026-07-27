import { createContext, useContext } from 'react';

const CaseContext = createContext(null);

export function CaseProvider({ children, value }) {
  return <CaseContext.Provider value={value}>{children}</CaseContext.Provider>;
}

export function useCaseContext() {
  const ctx = useContext(CaseContext);
  if (!ctx) throw new Error('useCaseContext must be used within CaseProvider');
  return ctx;
}
