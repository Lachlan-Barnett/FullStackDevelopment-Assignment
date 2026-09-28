export interface User {
  id: number;
  email: string;
  username: string;
  birthdate: string;
  role: 'user' | 'superadmin';
  profilePhoto?: string | null; // server path, e.g. /uploads/avatars/2.png?v=...
}
