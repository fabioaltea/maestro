import type { LLMCallOptions, LLMProvider, LLMResponse } from './provider.js';

export class ClaudeCodeProvider implements LLMProvider {
  call(_opts: LLMCallOptions): Promise<LLMResponse> {
    throw new Error(
      'Claude Code CLI mode not yet implemented for direct LLM calls. Use anthropic-api mode.',
    );
  }

  stream(_opts: LLMCallOptions, _onChunk: (text: string) => void): Promise<LLMResponse> {
    throw new Error(
      'Claude Code CLI mode not yet implemented for direct LLM calls. Use anthropic-api mode.',
    );
  }
}
