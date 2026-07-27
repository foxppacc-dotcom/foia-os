import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchCaseDashboard, fetchUsers, fetchSpecializedUsers, fetchAgencies } from '../services/caseApi';
import { ModuleBridge } from '../../../domain/services/ModuleBridge';

export function useCaseData(id) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState([]);
  const [specializedUsers, setSpecializedUsers] = useState([]);
  const [allAgencies, setAllAgencies] = useState([]);
  const cachedUsers = useRef(null);
  const cachedSpecUsers = useRef(null);
  const cachedAgencies = useRef(null);
  const bridgeRef = useRef(null);
  if (!bridgeRef.current) bridgeRef.current = new ModuleBridge();

  const refetch = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    fetchCaseDashboard(id).then(d => { setData(d); if (!silent) setLoading(false); })
      .catch(() => { if (!silent) setLoading(false); });
    if (!cachedUsers.current) {
      fetchUsers().then(u => { setUsers(u); cachedUsers.current = u; }).catch(() => {});
    }
    if (!cachedSpecUsers.current) {
      fetchSpecializedUsers().then(su => { setSpecializedUsers(su); cachedSpecUsers.current = su; }).catch(() => {});
    }
    if (!cachedAgencies.current) {
      fetchAgencies().then(a => { setAllAgencies(a); cachedAgencies.current = a; }).catch(() => {});
    }
  }, [id]);

  useEffect(() => { refetch(); }, [refetch]);

  useEffect(() => {
    const unsub = bridgeRef.current.subscribeCase(id, refetch);
    return unsub;
  }, [id, refetch]);

  return { data, loading, users, specializedUsers, allAgencies, refetch };
}
