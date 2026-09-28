// Address of the Node/Express server. Change it here if the server moves.
export const SERVER_URL = 'http://localhost:3000';

// REST endpoints live under /api.
export const API_URL = `${SERVER_URL}/api`;

// Socket.IO connects to the server root, not the /api path.
export const SOCKET_URL = SERVER_URL;
