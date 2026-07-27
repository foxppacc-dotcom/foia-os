import { createContext, useContext } from 'react';

const RequestContext = createContext(null);

export function RequestProvider({ children, value }) {
  return <RequestContext.Provider value={value}>{children}</RequestContext.Provider>;
}

export function useRequestContext() {
  const ctx = useContext(RequestContext);
  if (!ctx) throw new Error('useRequestContext must be used within RequestProvider');
  return ctx;
}
