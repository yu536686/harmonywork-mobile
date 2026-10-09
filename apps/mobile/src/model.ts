export type MessageRole = 'user' | 'assistant';

export type ChatMessage = {
  id: string;
  role: MessageRole;
  content: string;
  seq?: number;
};

export type ChatSession = {
  id: string;
  title: string;
  updatedAt: number;
  messages: ChatMessage[];
};

export type AccountView = {
  id: string;
  name: string;
  email: string;
  model: string;
};
