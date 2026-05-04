import Anthropic from '@anthropic-ai/sdk';
import { existsSync, readFileSync } from 'node:fs';
import YAML from 'yaml';
import { userGlobalConfigFile } from '../utils/paths.js';
import { GlobalConfigSchema } from '../schemas/config.js';
import type { LLMCallOptions, LLMProvider, LLMResponse, ToolDefinition } from './provider.js';

function resolveApiKey(): string {
  if (process.env['ANTHROPIC_API_KEY']) return process.env['ANTHROPIC_API_KEY'];
  const cfgFile = userGlobalConfigFile();
  if (existsSync(cfgFile)) {
    try {
      const cfg = GlobalConfigSchema.parse(YAML.parse(readFileSync(cfgFile, 'utf8')));
      if (cfg.anthropic_api_key) return cfg.anthropic_api_key;
    } catch {}
  }
  throw new Error(
    'Anthropic API key not found. Set ANTHROPIC_API_KEY env var or add anthropic_api_key to ~/.maestro/config.yaml',
  );
}

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic({ apiKey: apiKey ?? resolveApiKey() });
  }

  async call(opts: LLMCallOptions): Promise<LLMResponse> {
    const response = await this.client.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 8192,
      system: [{ type: 'text', text: opts.systemPrompt, cache_control: { type: 'ephemeral' } }],
      messages: opts.messages.map((m) => ({ role: m.role, content: m.content })),
      tools: opts.tools as Anthropic.Tool[] | undefined,
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    const toolUses = response.content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      .map((b) => ({ id: b.id, name: b.name, input: b.input as Record<string, unknown> }));

    return {
      content: text,
      toolUses,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      stopReason: response.stop_reason ?? 'end_turn',
    };
  }

  async stream(opts: LLMCallOptions, onChunk: (text: string) => void): Promise<LLMResponse> {
    const result = await this.streamWithTools({
      model: opts.model,
      systemPrompt: opts.systemPrompt,
      messages: opts.messages.map((m) => ({ role: m.role, content: m.content })),
      tools: opts.tools ?? [],
      maxTokens: opts.maxTokens,
      onChunk,
    });

    const text = result.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    const toolUses = result.content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      .map((b) => ({ id: b.id, name: b.name, input: b.input as Record<string, unknown> }));

    return {
      content: text,
      toolUses,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      stopReason: result.stopReason,
    };
  }

  async streamWithTools(opts: {
    model: string;
    systemPrompt: string;
    messages: Anthropic.MessageParam[];
    tools: ToolDefinition[];
    maxTokens?: number;
    onChunk: (text: string) => void;
  }): Promise<{
    content: Anthropic.ContentBlock[];
    inputTokens: number;
    outputTokens: number;
    stopReason: string;
  }> {
    const stream = this.client.messages.stream({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 8192,
      system: [{ type: 'text', text: opts.systemPrompt, cache_control: { type: 'ephemeral' } }],
      messages: opts.messages,
      tools: opts.tools as Anthropic.Tool[],
    });

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        opts.onChunk(event.delta.text);
      }
    }

    const final = await stream.finalMessage();
    return {
      content: final.content,
      inputTokens: final.usage.input_tokens,
      outputTokens: final.usage.output_tokens,
      stopReason: final.stop_reason ?? 'end_turn',
    };
  }
}
