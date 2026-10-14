import { apiRequest } from './client';

export function fetchDepartments() {
  return apiRequest('/api/departments');
}
