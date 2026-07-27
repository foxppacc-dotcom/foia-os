import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { FileText } from 'lucide-react';
import Tabs from '../components/ui/Tabs';
import Spinner from '../components/ui/Spinner';
import EmptyState from '../components/ui/EmptyState';
import CaseHeader from '../features/case/components/CaseHeader';
import OverviewTab from '../features/case/components/OverviewTab';
import TeamTab from '../features/case/components/TeamTab';
import AgenciesTab from '../features/case/components/AgenciesTab';
import ChecklistTab from '../features/case/components/ChecklistTab';
import DocumentsTab from '../features/case/components/DocumentsTab';
import TimelineTab from '../features/case/components/TimelineTab';
import CommunicationCenter from '../features/case/components/CommunicationCenter';
import FilePreview from '../features/case/components/FilePreview';
import { CaseProvider } from '../features/case/context/CaseContext';
import { useCaseData } from '../features/case/hooks/useCaseData';
import { useChecklist } from '../features/case/hooks/useChecklist';
import { useDocuments } from '../features/case/hooks/useDocuments';
import { useAssignments } from '../features/case/hooks/useAssignments';
import { TABS } from '../features/case/constants';

export default function CaseDetail() {
  const { id } = useParams();
  const [activeTab, setActiveTab] = useState('overview');
  const { data, loading, users, specializedUsers, allAgencies, refetch } = useCaseData(id);
  const { updateChecklist, debouncedSaveNote } = useChecklist(id, refetch);
  const { newDoc, setNewDoc, previewFile, setPreviewFile, addDocument, removeDocument, detectFileType } = useDocuments(id, refetch);
  const { handleAddTeam, handleRemoveTeam, getFilteredUsers } = useAssignments(id, refetch);

  if (loading) return <Spinner full />;
  if (!data) return (
    <EmptyState icon={FileText} title="تعذر تحميل القضية"
      action={<Link to="/cases" className="text-sm hover:underline" style={{ color: 'var(--accent)' }}>العودة للقضايا</Link>} />
  );

  const { case: c, team, requests, checklist, documents, timeline, records_progress } = data;
  const ctx = { id, c, team, requests, checklist, documents, timeline, records_progress, users, specializedUsers, allAgencies, refetch, updateChecklist, debouncedSaveNote, newDoc, setNewDoc, addDocument, removeDocument, detectFileType, previewFile, setPreviewFile, handleAddTeam, handleRemoveTeam, getFilteredUsers };

  return (
    <CaseProvider value={ctx}>
      <div className="space-y-6 animate-fadeIn">
        <CaseHeader />
        <Tabs tabs={TABS} active={activeTab} onChange={setActiveTab} />
        {activeTab === 'overview' && <OverviewTab />}
        {activeTab === 'team' && <TeamTab />}
        {activeTab === 'agencies' && <AgenciesTab />}
        {activeTab === 'checklist' && <ChecklistTab />}
        {activeTab === 'documents' && <DocumentsTab />}
        {activeTab === 'communications' && <CommunicationCenter caseId={id} />}
        {activeTab === 'timeline' && <TimelineTab />}
        <FilePreview />
      </div>
    </CaseProvider>
  );
}
