import { apiRequest } from './client';

export function fetchUsers() {
  return apiRequest('/api/users');
}

export function fetchUser(id) {
  return apiRequest(`/api/users/${id}`);
}
