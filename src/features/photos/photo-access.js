import { useEffect, useState } from 'react';
import { getFirestore, doc, onSnapshot } from 'firebase/firestore';

export function photoAllowed(uid, membership, client) {
  return membership?.status === 'active' && ['owner', 'area_manager', 'manager', 'instructor', 'staff'].includes(membership.role)
    && !!client && client.photoAccessRevoked?.[uid] !== true
    && (['owner', 'area_manager'].includes(membership.role) || (client.instructorIds || []).includes(uid));
}
// Never use the Firestore offline cache as authority. Server rules independently enforce the same boundary.
export function usePhotoAccess({ uid, organizationId, members, onRevoke }) {
  const scopeKey = `${uid || ''}/${organizationId || ''}`;
  const [state, setState] = useState({ scopeKey: '', allowed: new Set() });
  const key = JSON.stringify(members.map((m) => [m.id, m.orgClientId]));
  useEffect(() => {
    const setAllowed = (allowed) => setState({ scopeKey, allowed });
    setAllowed(new Set());
    if (!uid || !organizationId) return;
    let membership = null;
    const clients = new Map(), previous = new Set();
    const publish = () => {
      const next = new Set();
      if (navigator.onLine) for (const [id, client] of clients) if (photoAllowed(uid, membership, client)) next.add(id);
      for (const id of previous) if (!next.has(id)) onRevoke?.(id);
      previous.clear(); next.forEach((id) => previous.add(id)); setAllowed(next);
    };
    const fs = getFirestore();
    const stops = [onSnapshot(doc(fs, 'memberships', `${organizationId}_${uid}`), { includeMetadataChanges: true }, (s) => { membership = s.metadata.fromCache ? null : s.data(); publish(); }, () => { membership = null; publish(); })];
    for (const [id, clientId] of JSON.parse(key)) {
      if (!clientId) continue;
      stops.push(onSnapshot(doc(fs, 'organizations', organizationId, 'clients', clientId), { includeMetadataChanges: true }, (s) => { clients.set(id, s.metadata.fromCache ? null : s.data()); publish(); }, () => { clients.delete(id); publish(); }));
    }
    window.addEventListener('offline', publish);
    return () => { stops.forEach((stop) => stop()); window.removeEventListener('offline', publish); };
  }, [uid, organizationId, key, onRevoke]);
  return state.scopeKey === scopeKey ? state.allowed : new Set();
}
