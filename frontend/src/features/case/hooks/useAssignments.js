import { useState, useCallback } from 'react';
import { addTeamMember, removeTeamMember } from '../services/caseApi';
import { ModuleBridge } from '../../../domain/services/ModuleBridge';

export function useAssignments(caseId, onUpdate) {
  const [showAddTeam, setShowAddTeam] = useState(false);
  const [teamForm, setTeamForm] = useState({ user_id: '', role: 'custom', custom_role_name: '' });

  const handleAddTeam = useCallback(async (userId, role, customRoleName) => {
    if (!userId) return;
    try {
      await addTeamMember(caseId, { user_id: parseInt(userId), role: role || 'custom', custom_role_name: customRoleName || undefined });
      onUpdate(true); ModuleBridge.notifyCaseChanged(caseId, 'team.changed');
    } catch (e) { alert('❌ ' + e.message); }
  }, [caseId, onUpdate]);

  const handleRemoveTeam = useCallback(async (userId) => {
    try { await removeTeamMember(caseId, userId); onUpdate(true); ModuleBridge.notifyCaseChanged(caseId, 'team.changed'); } catch (e) { alert('❌ ' + e.message); }
  }, [caseId, onUpdate]);

  const getFilteredUsers = useCallback((roleType, team, availableUsers, specializedUsers) => {
    if (roleType === 'custom') return availableUsers;
    const specMap = { 'mail_records_officer': 'Mail Records Receiver', 'mail_payment_officer': 'Mail Payment Officer', 'citizenship_officer': 'Citizenship Verifier' };
    const requiredSpec = specMap[roleType];
    const specUsers = specializedUsers.filter(u => u.specialties?.some(s => s.name_en === requiredSpec));
    const assignedIds = new Set(team?.map(t => t.user_id) || []);
    return [...specUsers, ...availableUsers.filter(u => assignedIds.has(u.id) && !specUsers.find(su => su.id === u.id))];
  }, []);

  return {
    showAddTeam, setShowAddTeam, teamForm, setTeamForm,
    handleAddTeam, handleRemoveTeam, getFilteredUsers,
  };
}
