/** Representative legacy/public contracts the UI platform must not change. */
export const UI_PLATFORM_API_CONTRACT_FIXTURES = Object.freeze({
  dashboardStatus: Object.freeze({ path: '/api/status', method: 'GET', status: 200, auth: 'public-dashboard-read' }),
  publicSpecification: Object.freeze({ path: '/api/v1/openapi.yaml', method: 'GET', status: 200, auth: 'none' }),
  protectedTasks: Object.freeze({ path: '/api/v1/tasks', method: 'GET', status: 401, auth: 'bearer-api-key' }),
});
