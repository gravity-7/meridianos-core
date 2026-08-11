export const MANAGEMENT_SCOPE = Object.freeze({ tenantId: 'tenant-a', projectId: 'project-a' });
export const FOREIGN_SCOPE = Object.freeze({ tenantId: 'tenant-b', projectId: 'project-b' });
export const managementConfig = Object.freeze({ gateway: { tenant: 'tenant-a' } });
export const actors = Object.freeze({ admin: { sub: 'admin-a', role: 'admin' }, operator: { sub: 'operator-a', role: 'operator' }, viewer: { sub: 'viewer-a', role: 'viewer' }, foreign: { sub: 'admin-b', role: 'admin' } });
export const safeSecret = 'mk-test-secret-never-persist';
