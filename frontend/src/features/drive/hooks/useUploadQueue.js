import { useState, useEffect } from 'react';
import uploadManager from '../services/uploadManager';

export function useUploadQueue() {
  const [queue, setQueue] = useState([]);
  const [stats, setStats] = useState(uploadManager.getStats());

  useEffect(() => {
    uploadManager.onChange((q) => {
      setQueue(q);
      setStats(uploadManager.getStats());
    });
    return () => uploadManager.onChange(null);
  }, []);

  return {
    queue,
    stats,
    enqueue: (files, caseId, meta) => uploadManager.enqueue(files, caseId, meta),
    pause: (id) => uploadManager.pause(id),
    resume: (id) => uploadManager.resume(id),
    cancel: (id) => uploadManager.cancel(id),
    retry: (id) => uploadManager.retry(id),
    pauseAll: () => uploadManager.pauseAll(),
    resumeAll: () => uploadManager.resumeAll(),
    cancelAll: () => uploadManager.cancelAll(),
    retryAll: () => uploadManager.retryAll(),
    clearCompleted: () => uploadManager.clearCompleted(),
  };
}
