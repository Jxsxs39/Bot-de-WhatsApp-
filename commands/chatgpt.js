const API_URL = 'https://api.openai.com/v1/chat/completions';
const MAX_PROMPT_LENGTH = 4000;

const historiaPersona = [
  'Interpreta a Historia Reiss como una asistente cálida, compasiva, humilde y valiente, con serenidad y una presencia regia.',
  'Habla de forma natural, cercana y esperanzadora, como una persona; no imites ni cites diálogos existentes de ninguna obra.',
  'Responde en el idioma del usuario, prioriza respuestas útiles y concisas, y reconoce con honestidad cuando no sepas algo.'
].join(' ');

export class ChatGptRequestError extends Error {
  constructor(code, message, userMessage, status) {
    super(message);
    this.name = 'ChatGptRequestError';
    this.code = code;
    this.userMessage = userMessage;
    this.status = status;
  }
}

export async function requestHistoriaAI(prompt, {
  apiKey = process.env.OPENAI_API_KEY,
  model = process.env.OPENAI_MODEL || 'gpt-4o-mini',
  fetchImpl = fetch
} = {}) {
  if (!apiKey) {
    throw new ChatGptRequestError(
      'NO_API_KEY',
      'OPENAI_API_KEY is missing',
      'La IA todavía no está configurada. Añade OPENAI_API_KEY en las variables del hosting.'
    );
  }

  const response = await fetchImpl(API_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: historiaPersona },
        { role: 'user', content: prompt }
      ],
      max_completion_tokens: 500
    }),
    signal: AbortSignal.timeout(25000)
  });

  if (!response.ok) {
    const userMessage = response.status === 401 || response.status === 403
      ? 'La clave de OpenAI no es válida o no tiene acceso. Revisa OPENAI_API_KEY.'
      : response.status === 429
        ? 'La IA está ocupada o se alcanzó el límite de uso. Inténtalo más tarde.'
        : 'No pude obtener una respuesta de la IA ahora. Inténtalo de nuevo más tarde.';
    throw new ChatGptRequestError(
      'API_ERROR',
      `OpenAI returned HTTP ${response.status}`,
      userMessage,
      response.status
    );
  }

  const payload = await response.json();
  const answer = payload?.choices?.[0]?.message?.content;
  if (typeof answer !== 'string' || !answer.trim()) {
    throw new ChatGptRequestError(
      'EMPTY_RESPONSE',
      'OpenAI returned no message content',
      'La IA no devolvió una respuesta. Prueba con otra pregunta.'
    );
  }
  return answer.trim();
}

export default [
  {
    name: 'chatgpt',
    async run({ reply, args }) {
      const prompt = args.join(' ').trim();
      if (!prompt) return reply('Escribe tu pregunta después de .chatgpt. Ejemplo: .chatgpt ¿cómo puedo animar a una amiga?');
      if (prompt.length > MAX_PROMPT_LENGTH) {
        return reply(`Tu mensaje es demasiado largo. El límite es ${MAX_PROMPT_LENGTH} caracteres.`);
      }

      let answer;
      try {
        answer = await requestHistoriaAI(prompt);
      } catch (error) {
        if (error instanceof ChatGptRequestError) {
          console.error('[CHATGPT]', error.code, error.status || '');
          return reply(error.userMessage);
        }
        console.error('[CHATGPT] Error de conexión:', error?.name || 'Error');
        return reply('No pude conectar con la IA ahora. Inténtalo de nuevo más tarde.');
      }
      return reply(answer);
    }
  }
];
