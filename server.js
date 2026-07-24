// ==========================================
// AI Copilot Universal - Backend Completo (Node.js / Express)
// ==========================================

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import crypto from 'crypto';
import multer from 'multer';
import { MercadoPagoConfig, Preference } from 'mercadopago';

dotenv.config();

const app = express();

// Configuración de Multer para recibir archivos temporales de audio en memoria
const upload = multer({ storage: multer.memoryStorage() });

// Middlewares
app.use(cors());
app.use(express.json());

// Instancia de OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Instancia de Mercado Pago
const mpClient = new MercadoPagoConfig({ 
  accessToken: process.env.MP_ACCESS_TOKEN || 'TU_ACCESS_TOKEN_DE_MERCADO_PAGO' 
});

// Contexto base por defecto si el usuario no configura nada
const CONTEXTO_NEGOCIO_DEFAULT = `
Somos una empresa que ofrece soluciones de software, páginas web, soporte técnico y automatizaciones para negocios.
Ofrecemos atención de alta calidad, acompañamiento continuo y facilidades de acceso.
`;

// Base de datos en memoria para validar licencias / Free Trial
const USAGE_LIMIT_FREE_TRIAL = 1000;
const memoryDb = new Map(); // Key: licenseKey, Value: { usageCount: number, status: 'trial' | 'active', email: string, expiresAt: string }

// Helper para generar claves de licencia únicas (ej: PRES-A1B2-C3D4-E5F6)
function generateLicenseKey(prefix = 'PRES') {
  const bytes = crypto.randomBytes(6).toString('hex').toUpperCase();
  const part1 = bytes.substring(0, 4);
  const part2 = bytes.substring(4, 8);
  const part3 = bytes.substring(8, 12);
  return `${prefix}-${part1}-${part2}-${part3}`;
}

// ==========================================
// MIDDLEWARE: Validación de Licencia / Free Trial
// ==========================================
async function validarLicencia(req, res, next) {
  const licenseKey = req.headers['x-user-license'] || 'TRIAL_KEY';

  // Inicializar usuario en la memoria si no existe
  if (!memoryDb.has(licenseKey)) {
    memoryDb.set(licenseKey, { usageCount: 0, status: 'trial' });
  }

  const user = memoryDb.get(licenseKey);

  // Si está en prueba gratuita, validar el límite de respuestas
  if (user.status === 'trial') {
    if (user.usageCount >= USAGE_LIMIT_FREE_TRIAL) {
      return res.status(403).json({
        error: `Has agotado tus ${USAGE_LIMIT_FREE_TRIAL} respuestas de prueba. ¡Activa tu plan Pro para continuar!`,
        code: 'TRIAL_EXPIRED'
      });
    }
    user.usageCount += 1;
    memoryDb.set(licenseKey, user);
  } else if (user.status === 'active') {
    if (user.expiresAt && new Date(user.expiresAt) < new Date()) {
      user.status = 'expired';
      memoryDb.set(licenseKey, user);
      return res.status(403).json({
        error: 'Tu suscripción ha expirado. Por favor renueva tu plan.',
        code: 'TRIAL_EXPIRED'
      });
    }
  } else {
    return res.status(403).json({ 
      error: 'Tu suscripción no está activa. Revisa tu estado de pago.',
      code: 'SUBSCRIPTION_INACTIVE'
    });
  }

  next();
}

// ==========================================
// ENDPOINT NUEVO: Generador de System Prompt Personalizado (Meta-Prompt)
// ==========================================
app.post('/api/generar-system-prompt', async (req, res) => {
  try {
    const { descripcionNegocio, objetivoBot } = req.body;

    if (!descripcionNegocio) {
      return res.status(400).json({ error: 'La descripción del negocio es requerida.' });
    }

    const systemPromptMeta = `
      Eres un experto Prompt Engineer especialista en arquitectura de IA para asistentes conversacionales y venta directa por WhatsApp.
      
      OBJETIVO:
      Crear una instrucción de sistema (System Prompt) estructurada, profesional y altamente efectiva para entrenar al chatbot de WhatsApp de este cliente.

      DATOS DEL CLIENTE:
      - Descripción del Negocio / Servicio: "${descripcionNegocio}"
      - Objetivo Principal del Bot: "${objetivoBot || 'Atender clientes, resolver dudas y concretar ventas o citas.'}"

      INSTRUCCIONES DE SALIDA:
      Escribe un System Prompt claro, redactado en segunda persona ("Eres un..."). Debe definir:
      1. El rol y personalidad del asistente.
      2. Reglas de comunicación (brevedad para WhatsApp, emojis clave, tono).
      3. Cómo guiar al cliente hacia el objetivo principal.
      
      REGLA CRÍTICA: Devuelve ÚNICAMENTE el texto del System Prompt listo para usar, sin introducciones ni comentarios adicionales.
    `;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: systemPromptMeta }],
      temperature: 0.7,
      max_tokens: 350
    });

    const promptGenerado = completion.choices[0].message.content.trim();
    return res.json({ promptGenerado });

  } catch (error) {
    console.error('Error en /api/generar-system-prompt:', error.message);
    return res.status(500).json({ error: 'Error al generar la instrucción personalizada de IA.' });
  }
});

// ==========================================
// ENDPOINT PASARELA DE PAGOS: Crear Checkout
// ==========================================
app.post('/api/crear-checkout', async (req, res) => {
  try {
    const { email, plan } = req.body;
    const precio = plan === 'anual' ? 120 : 15;

    const preference = new Preference(mpClient);
    const result = await preference.create({
      body: {
        items: [
          {
            id: plan,
            title: `AI Sales Copilot - Licencia ${plan.toUpperCase()}`,
            quantity: 1,
            unit_price: Number(precio),
            currency_id: 'USD'
          }
        ],
        payer: { email },
        back_urls: {
          success: 'https://tuweb.com/gracias.html',
          failure: 'https://tuweb.com/cancelado.html'
        },
        auto_return: 'approved',
        notification_url: 'https://tu-backend.com/api/webhook-mercadopago'
      }
    });

    res.json({ init_point: result.init_point });
  } catch (error) {
    console.error('Error al crear checkout de pago:', error.message);
    res.status(500).json({ error: 'Error al procesar la solicitud de pago.' });
  }
});

// ==========================================
// ENDPOINT PASARELA DE PAGOS: Webhook
// ==========================================
app.post('/api/webhook-mercadopago', async (req, res) => {
  try {
    const { type } = req.body;

    if (type === 'payment') {
      const newLicenseKey = generateLicenseKey('PRES');
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);

      memoryDb.set(newLicenseKey, {
        status: 'active',
        usageCount: 0,
        expiresAt: expiresAt.toISOString()
      });

      console.log(`\n==================================================`);
      console.log(`✅ ¡NUEVA LICENCIA ACTIVADA!`);
      console.log(`Clave: ${newLicenseKey}`);
      console.log(`Válida hasta: ${expiresAt.toISOString()}`);
      console.log(`==================================================\n`);
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('Error en webhook Mercado Pago:', error.message);
    res.sendStatus(500);
  }
});

// ==========================================
// ENDPOINT 1: Analizar Intención en Segundo Plano (Clasificación)
// ==========================================
app.post('/api/analizar-intencion', async (req, res) => {
  try {
    const { cliente, mensaje } = req.body;

    if (!mensaje) {
      return res.status(400).json({ error: 'El parámetro "mensaje" es obligatorio.' });
    }

    const systemPrompt = `
      Eres un clasificador de mensajes de WhatsApp en tiempo real.
      Tu trabajo es analizar el mensaje entrante y determinar la prioridad de atención.

      Criterios de clasificación:
      - "ALTA": El cliente pide precios, métodos de pago, reporta un fallo crítico de soporte, quiere comprar o solicita atención urgente.
      - "MEDIA": Pide información general, hace preguntas frecuentes o dudas sobre características técnicas/servicios.
      - "BAJA": Saludos simples ("Hola", "Buenas"), agradecimientos ("Gracias") o mensajes irrelevantes.

      RESPONDE ÚNICAMENTE EN FORMATO JSON ESTRICTO con el siguiente esquema:
      {
        "prioridad": "ALTA" | "MEDIA" | "BAJA",
        "razon": "Explicación breve de 1 oración de por qué se asignó esta prioridad"
      }
    `;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Mensaje recibido de ${cliente || 'Cliente'}: "${mensaje}"` }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1
    });

    const resultado = JSON.parse(completion.choices[0].message.content);
    return res.json(resultado);

  } catch (error) {
    console.error('Error en /api/analizar-intencion:', error.message);
    return res.status(500).json({
      prioridad: 'BAJA',
      razon: 'Error interno al analizar el mensaje'
    });
  }
});

// ==========================================
// ENDPOINT 2: Generar Respuesta Universal (Con LOGS DE DEPURACIÓN DE MEMORIA)
// ==========================================
app.post('/api/generar-respuesta', validarLicencia, async (req, res) => {
  try {
    const { 
      mensajeCliente, 
      historialChat, 
      contextoNegocio, 
      promptEntrenamientoUsuario, 
      modoOperacion, 
      tipoAccion, 
      tono 
    } = req.body;

    // 🔎 LOGS DE DEPURACIÓN: Ver qué está llegando exactamente desde el frontend
    console.log('\n================ DEPURACIÓN DE MEMORIA / HISTORIAL ================');
    console.log('📥 Mensaje actual del cliente:', mensajeCliente);
    console.log('📚 ¿Llegó historialChat?:', historialChat ? `Sí (Elementos: ${historialChat.length})` : 'NO / VACÍO');
    if (historialChat && Array.isArray(historialChat)) {
      console.log('📋 Contenido del historial:', JSON.stringify(historialChat, null, 2));
    }
    console.log('===================================================================\n');

    if (!mensajeCliente) {
      return res.status(400).json({ error: 'El parámetro "mensajeCliente" es obligatorio.' });
    }

    // CASO ESPECIAL: Análisis de Lectura / Explicación
    if (tipoAccion === 'analizar_explicar') {
      let conversacionContexto = '';
      if (historialChat && Array.isArray(historialChat) && historialChat.length > 0) {
        conversacionContexto = `\nHISTORIAL RECIENTE DEL CHAT:\n` + historialChat.map(m => `- ${m.remitente.toUpperCase()}: ${m.texto}`).join('\n');
      }

      const promptExplicacion = `
        Eres un asistente analista de comunicación comercial.
        Analiza el siguiente mensaje entrante y el contexto del chat.
        
        OBJETIVO:
        Explica en MÁXIMO 2 oraciones breves, claras y directas cuál es la intención real, la necesidad, la duda o el problema del cliente.

        ${conversacionContexto}
        Mensaje actual del cliente: "${mensajeCliente}"
      `;

      const completionAnalisis = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: promptExplicacion }],
        temperature: 0.2,
        max_tokens: 150
      });

      return res.json({ respuesta: completionAnalisis.choices[0].message.content.trim() });
    }

    // 1. Configurar Comportamiento según Modo
    let reglaModo = '';
    switch (modoOperacion) {
      case 'soporte':
        reglaModo = `
          ROL: Especialista de Soporte Técnico.
          OBJETIVO: Ayudar al usuario a resolver su problema técnico o duda operativa de forma paciente y resolutiva.
        `;
        break;

      case 'informacion':
        reglaModo = `
          ROL: Asistente de Información General y FAQ.
          OBJETIVO: Responder preguntas sobre servicios, horarios, requisitos y políticas con total claridad.
        `;
        break;

      case 'ventas':
      default:
        let instruccionAccion = '';
        if (tipoAccion === 'rebatir_precio') {
          instruccionAccion = 'El cliente cuestiona el precio. Muestra empatía, resalta el valor percibido y propone un siguiente paso comercial.';
        } else {
          instruccionAccion = 'Dirige al cliente hacia el cierre de venta, agendamiento de cita o el siguiente paso comercial.';
        }

        reglaModo = `
          ROL: Especialista en Ventas y Cierre Comercial por WhatsApp.
          OBJETIVO: ${instruccionAccion}
          INSTRUCCIÓN EXTRA: Si el cliente ya confirmó una cita, aceptó el enlace o cerró la negociación, NO hagas más preguntas. Limítate a confirmar con un mensaje amable, directo y profesional (ej: "Perfecto, quedamos agendados. ¡Un saludo!"). Si la conversación sigue abierta, termina con un llamado a la acción directo.
        `;
        break;
    }

    // 2. Configurar Instrucciones de Tono
    let instruccionTono = '';
    switch (tono) {
      case 'empatico':
        instruccionTono = 'Usa un tono cálido, amable, comprensivo y cercano.';
        break;
      case 'urgencia':
        instruccionTono = 'Agrega un sentido sutil de escasez o prioridad de atención.';
        break;
      case 'persuasivo':
        instruccionTono = 'Usa un tono altamente persuasivo y enfocado en beneficios de alto valor.';
        break;
      case 'breve':
        instruccionTono = 'Sé extremadamente breve, conciso y directo al grano.';
        break;
      case 'oferta':
        instruccionTono = 'Enfócate en destacar la oferta especial, bonos o descuentos aplicables.';
        break;
      case 'directo':
      default:
        instruccionTono = 'Sé directo, profesional, claro y sin rodeos.';
        break;
    }

    // 3. System Prompt Compuesto
    const promptUsuarioCustom = promptEntrenamientoUsuario && promptEntrenamientoUsuario.trim().length > 0 
      ? `INSTRUCCIONES DE COMPORTAMIENTO Y ENTRENAMIENTO PERSONALIZADO DEL CLIENTE:\n${promptEntrenamientoUsuario}`
      : `INSTRUCCIONES DE COMPORTAMIENTO:\n${reglaModo}`;

    const infoNegocio = contextoNegocio || CONTEXTO_NEGOCIO_DEFAULT;

    const systemPrompt = `
      ${promptUsuarioCustom}

      CONTEXTO Y DATOS DEL NEGOCIO / OFERTA:
      ${infoNegocio}

      REGLAS DE FORMATO OBLIGATORIAS:
      - Tono a aplicar: ${instruccionTono}
      - Longitud: MÁXIMO 2 a 3 oraciones cortas (ideal para WhatsApp).
      - No uses saludos corporativos excesivamente largos o robóticos.
      - PROHIBIDO inventar reuniones, citas o llamadas a menos que el cliente lo pida explícitamente en su mensaje. Responde estrictamente al contexto de la conversación actual.
    `;

    // 4. Construir Mensajes para OpenAI mapeando correctamente roles user / assistant
    let mensajesChatOpenAI = [{ role: 'system', content: systemPrompt }];

    if (historialChat && Array.isArray(historialChat) && historialChat.length > 0) {
      historialChat.forEach(msg => {
        const remitente = (msg.remitente || msg.role || '').toLowerCase();
        // Mapeo corregido: si es el asesor/bot va como 'assistant', de lo contrario 'user'
        const rolOpenAI = (remitente === 'asesor' || remitente === 'assistant') ? 'assistant' : 'user';
        
        mensajesChatOpenAI.push({
          role: rolOpenAI,
          content: msg.texto || msg.content || '' 
        });
      });

      // Verificar si el último mensaje del historial ya coincide con el mensajeCliente actual
      const ultimoMsgObj = historialChat[historialChat.length - 1];
      const textoUltimo = ultimoMsgObj.texto || ultimoMsgObj.content || '';
      const remitenteUltimo = (ultimoMsgObj.remitente || ultimoMsgObj.role || '').toLowerCase();
      
      const esIgualAlUltimo = textoUltimo.trim() === mensajeCliente.trim() && (remitenteUltimo !== 'asesor' && remitenteUltimo !== 'assistant');

      if (!esIgualAlUltimo) {
        mensajesChatOpenAI.push({ 
          role: 'user', 
          content: mensajeCliente 
        });
      }
    } else {
      mensajesChatOpenAI.push({ 
        role: 'user', 
        content: mensajeCliente 
      });
    }

    // 🔎 LOG FINAL DE PAYLOAD ENVIADO A OPENAI
    console.log('🤖 Payload final de messages enviado a OpenAI:', JSON.stringify(mensajesChatOpenAI, null, 2));

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: mensajesChatOpenAI,
      temperature: 0.4, 
      max_tokens: 220
    });

    const respuestaIA = completion.choices[0].message.content.trim();
    return res.json({ respuesta: respuestaIA });

  } catch (error) {
    console.error('Error en /api/generar-respuesta:', error.message);
    return res.status(500).json({ error: 'Ocurrió un error al generar la respuesta de IA.' });
  }
});

// ==========================================
// NUEVO ENDPOINT: Transcribir Audio del Cliente (OpenAI Whisper)
// ==========================================
app.post('/api/transcribir-audio-cliente', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No se adjuntó ningún archivo de audio para transcribir.' });
    }

    const audioFile = await OpenAI.toFile(req.file.buffer, 'audio_cliente.ogg', {
      type: req.file.mimetype || 'audio/ogg'
    });

    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
    });

    return res.json({ success: true, texto: transcription.text });

  } catch (error) {
    console.error('Error en /api/transcribir-audio-cliente:', error);
    res.status(500).json({ success: false, error: error.message || 'No se pudo procesar el audio del cliente.' });
  }
});

// Ruta para generar audio con la API de OpenAI TTS (Notas de voz)
app.post('/api/generar-audio-ia', async (req, res) => {
  try {
    const { texto } = req.body;
    const apiKey = req.headers['x-user-license'] || process.env.OPENAI_API_KEY;

    if (!texto) {
      return res.status(400).json({ error: 'Falta el texto para convertir a voz.' });
    }

    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'tts-1', 
        voice: 'alloy', 
        input: texto,
        response_format: 'opus' // Formato idóneo para notas de voz en WhatsApp Web
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || 'Error al conectar con OpenAI TTS');
    }

    const audioBuffer = await response.arrayBuffer();

    res.set({
      'Content-Type': 'audio/ogg',
      'Content-Length': audioBuffer.byteLength
    });

    return res.send(Buffer.from(audioBuffer));

  } catch (error) {
    console.error('Error generando audio IA:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// ENDPOINT 3: Resumir Historial de Chat
// ==========================================
app.post('/api/resumir-chat', validarLicencia, async (req, res) => {
  try {
    const { historialChat } = req.body;

    if (!historialChat || !Array.isArray(historialChat)) {
      return res.status(400).json({ error: 'Se requiere un arreglo "historialChat".' });
    }

    const systemPrompt = `
      Eres un asistente analista ejecutivo. Analiza la conversación de WhatsApp y extrae un resumen ultraconciso.
      
      Responde ÚNICAMENTE en formato JSON:
      {
        "interesPrincipal": "Qué producto, servicio o problema presenta",
        "presupuestoOObjecion": "Dudas sobre precio, trabas u objeciones",
        "siguientePaso": "Acción recomendada para el agente"
      }
    `;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Analiza esta conversación:\n${historialChat.map(m => `${m.remitente}: ${m.texto}`).join('\n')}` }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2
    });

    const resumen = JSON.parse(completion.choices[0].message.content);
    return res.json(resumen);

  } catch (error) {
    console.error('Error en /api/resumir-chat:', error.message);
    return res.status(500).json({ error: 'Error al generar el resumen del chat.' });
  }
});

// Endpoint de verificación de estado
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'WhatsApp AI Universal Copilot Backend' });
});

// Inicialización del Servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(`🚀 Servidor AI Copilot corriendo en http://localhost:${PORT}`);
  console.log(`==================================================\n`);
});