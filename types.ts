export enum AvatarPose {
  IDLE_FRONT = 'IDLE_FRONT',
  LISTENING_SIDE = 'LISTENING_SIDE',
  THINKING_GHOST = 'THINKING_GHOST',
  WALKING_AWAY = 'WALKING_AWAY',
}

export interface AudioConfig {
  sampleRate: number;
}

export interface VisualizerData {
  volume: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  isFinal?: boolean; // For streaming transcriptions
}
