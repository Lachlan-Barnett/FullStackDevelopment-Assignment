export interface User {
  id: number;
  email: string;
  username: string;
  birthdate: string;
  role: 'user' | 'superadmin';
}
