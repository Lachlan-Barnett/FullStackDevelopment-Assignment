export type MessageType = 'text' | 'image';

export interface Message {
  id: number;
  roomId: number;
  senderId: number;
  senderName: string;
  type: MessageType;
  content: string; // the text, or the image URL for an image message
  timestamp: string;
}

// Someone currently viewing a room.
export interface PresentUser {
  userId: number;
  username: string;
}

// A "user joined" / "user left" notice shown in the room.
export interface PresenceEvent {
  type: 'joined' | 'left';
  roomId: number;
  user: PresentUser;
}
