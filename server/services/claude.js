const API_URL = 'https://api.anthropic.com/v1/messages';
const ATTEMPTS = 2;

export async function callClaude(prompt, schema, { model, maxTokens }) {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          output_config: { format: { type: 'json_schema', schema } },
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);

      const body = await res.json();
      const parsed = JSON.parse(body.content[0].text);
      console.log(
        `[claude] ${model} ${body.usage.input_tokens} in / ${body.usage.output_tokens} out tokens, stop ${body.stop_reason}`
      );
      return parsed;
    } catch (error) {
      console.warn(`[claude] ${model} attempt ${attempt} of ${ATTEMPTS} failed: ${error.message}`);
    }
  }
  return null;
}
