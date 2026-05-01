export type Role = 'user' | 'assistant';
export type Message = { role: Role; content: string };

export type ToolDefinition = {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
};

export type ToolUse = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type LLMCallOptions = {
  model: string;
  systemPrompt: string;
  messages: Message[];
  tools?: ToolDefinition[];
  maxTokens?: number;
};

export type LLMResponse = {
  content: string;
  toolUses: ToolUse[];
  inputTokens: number;
  outputTokens: number;
  stopReason: string;
};

export interface LLMProvider {
  call(opts: LLMCallOptions): Promise<LLMResponse>;
  stream(opts: LLMCallOptions, onChunk: (text: string) => void): Promise<LLMResponse>;
}
