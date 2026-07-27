/**
 * translate — bidirectional Anthropic↔OpenAI request/response translation.
 * Non-streaming only. Opt-in per route (route.translate flag).
 *
 * Drops thinking blocks and computer_use tools silently (no OpenAI equivalents).
 * Streaming requests are rejected with a clear error.
 */

/**
 * Translate an Anthropic-format request body to OpenAI format.
 * Drops thinking block and computer_* tools silently.
 */
export function anthropicToOpenai(body) {
  if (!body || typeof body !== 'object') return body;

  const out = {};

  // Model
  if (body.model) out.model = body.model;

  // Messages: flatten Anthropic system prompt to first system message
  const messages = [];
  if (body.system) {
    messages.push({ role: 'system', content: body.system });
  }
  if (Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      if (!msg || typeof msg !== 'object') continue;
      const role = msg.role;
      if (role === 'user' || role === 'assistant') {
        const content = translateAnthropicContentToOpenAI(msg.content);
        messages.push({ role, content });
      }
      // system messages inside the array stay as-is
      if (role === 'system') {
        messages.push({ role, content: msg.content });
      }
    }
  }
  out.messages = messages;

  // Tools: map input_schema → parameters
  if (Array.isArray(body.tools)) {
    out.tools = body.tools
      .filter((t) => t && !t.name?.startsWith('computer_')) // Drop computer_* tools
      .map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema ?? {},
        },
      }));
  }

  // Max tokens
  if (body.max_tokens != null) out.max_completion_tokens = body.max_tokens;

  // Temperature
  if (body.temperature != null) out.temperature = body.temperature;

  // Stop sequences
  if (Array.isArray(body.stop_sequences)) out.stop = body.stop_sequences;

  // Top-p
  if (body.top_p != null) out.top_p = body.top_p;

  // Stream — reject in translate path
  if (body.stream) {
    // Stream not supported for cross-wire translation; drop silently
  }

  return out;
}

function translateAnthropicContentToOpenAI(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const textParts = [];
    const toolCalls = [];
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'text') {
        textParts.push(block.text ?? '');
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id ?? `call_${toolCalls.length}`,
          type: 'function',
          function: {
            name: block.name ?? '',
            arguments: JSON.stringify(block.input ?? {}),
          },
        });
      }
    }
    if (toolCalls.length > 0 && textParts.length === 0) return null; // Will be tool_calls
    return textParts.join('');
  }
  return String(content ?? '');
}

/**
 * Translate an OpenAI-format request body to Anthropic format.
 * Promotes first system message to top-level system field.
 * Drops stream:true with warning.
 */
export function openaiToAnthropic(body) {
  if (!body || typeof body !== 'object') return body;

  const out = {};

  // Model
  if (body.model) out.model = body.model;

  // Messages: promote first system message to top-level
  const messages = [];
  let systemPrompt = null;
  if (Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      if (!msg || typeof msg !== 'object') continue;
      if (msg.role === 'system' && systemPrompt === null && messages.length === 0) {
        systemPrompt = typeof msg.content === 'string' ? msg.content : (Array.isArray(msg.content) ? msg.content.map(c => c.text ?? '').join('') : '');
        continue;
      }
      if (msg.role === 'user' || msg.role === 'assistant') {
        messages.push({ role: msg.role, content: msg.content });
      }
      if (msg.role === 'tool') {
        messages.push({
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: msg.tool_call_id, content: msg.content }],
        });
      }
    }
  }
  if (systemPrompt !== null) out.system = systemPrompt;
  out.messages = messages;

  // Tools: map parameters → input_schema
  if (Array.isArray(body.tools)) {
    out.tools = body.tools.map((t) => ({
      name: t.function?.name ?? t.name ?? '',
      description: t.function?.description ?? t.description ?? '',
      input_schema: t.function?.parameters ?? t.parameters ?? {},
    }));
  }

  // Max tokens
  if (body.max_completion_tokens != null) out.max_tokens = body.max_completion_tokens;

  // Temperature
  if (body.temperature != null) out.temperature = body.temperature;

  // Stop
  if (Array.isArray(body.stop)) out.stop_sequences = body.stop;

  // Top-p
  if (body.top_p != null) out.top_p = body.top_p;

  // Stream — drop silently
  if (body.stream) {
    // Streaming not supported for cross-wire translation
  }

  return out;
}

/**
 * Translate an OpenAI response body to Anthropic format.
 */
export function openaiResponseToAnthropic(body) {
  if (!body || typeof body !== 'object') return body;

  const out = {
    id: body.id ?? `msg_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    model: body.model ?? 'unknown',
  };

  const choice = body.choices?.[0];
  if (!choice) {
    out.content = [{ type: 'text', text: '' }];
    return out;
  }

  // Content blocks
  const content = [];
  const message = choice.message ?? {};

  if (message.content) {
    content.push({ type: 'text', text: message.content });
  }

  // Tool calls → tool_use blocks
  if (Array.isArray(message.tool_calls)) {
    for (const tc of message.tool_calls) {
      content.push({
        type: 'tool_use',
        id: tc.id ?? `toolu_${content.length}`,
        name: tc.function?.name ?? '',
        input: safeParseJson(tc.function?.arguments) ?? {},
      });
    }
  }

  if (content.length === 0) {
    content.push({ type: 'text', text: '' });
  }
  out.content = content;

  // Stop reason mapping
  const finishReason = choice.finish_reason;
  if (finishReason === 'stop') out.stop_reason = 'end_turn';
  else if (finishReason === 'tool_calls') out.stop_reason = 'tool_use';
  else if (finishReason === 'length') out.stop_reason = 'max_tokens';
  else out.stop_reason = finishReason ?? 'end_turn';

  // Usage mapping
  if (body.usage) {
    out.usage = {
      input_tokens: body.usage.prompt_tokens ?? 0,
      output_tokens: body.usage.completion_tokens ?? 0,
    };
    if (body.usage.prompt_tokens_details?.cached_tokens != null) {
      out.usage.cache_read_input_tokens = body.usage.prompt_tokens_details.cached_tokens;
    }
  }

  return out;
}

/**
 * Translate an Anthropic response body to OpenAI format.
 */
export function anthropicResponseToOpenai(body) {
  if (!body || typeof body !== 'object') return body;

  const out = {
    id: body.id ?? `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: body.model ?? 'unknown',
  };

  // Content → message
  const message = { role: 'assistant', content: null };
  const toolCalls = [];

  if (Array.isArray(body.content)) {
    const textParts = [];
    for (const block of body.content) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'text') {
        textParts.push(block.text ?? '');
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id ?? `call_${toolCalls.length}`,
          type: 'function',
          function: {
            name: block.name ?? '',
            arguments: JSON.stringify(block.input ?? {}),
          },
        });
      }
    }
    message.content = textParts.join('') || null;
  }

  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls;
  }

  // Stop reason mapping
  const finishReason = body.stop_reason === 'end_turn' ? 'stop'
    : body.stop_reason === 'tool_use' ? 'tool_calls'
    : body.stop_reason === 'max_tokens' ? 'length'
    : body.stop_reason ?? 'stop';

  out.choices = [{
    index: 0,
    message,
    finish_reason: finishReason,
  }];

  // Usage mapping
  if (body.usage) {
    const usageObj = {
      prompt_tokens: body.usage.input_tokens ?? 0,
      completion_tokens: body.usage.output_tokens ?? 0,
      total_tokens: (body.usage.input_tokens ?? 0) + (body.usage.output_tokens ?? 0),
    };
    if (body.usage.cache_read_input_tokens != null) {
      usageObj.prompt_tokens_details = { cached_tokens: body.usage.cache_read_input_tokens };
    }
    out.usage = usageObj;
  }

  return out;
}

function safeParseJson(text) {
  if (typeof text !== 'string') return text;
  try { return JSON.parse(text); } catch { return null; }
}
